import { githubFetch, githubPages, graphql, installationToken, refreshProjectToken, refreshUserToken, seal, unseal, userInstallations, GitHubError, type GitHubEnv } from './githubApi'

export type Connection = {
  id: string; owner_id: string; context: 'personal' | 'work'; installation_id: number;
  account_login: string; account_type: 'User' | 'Organization'; encrypted_refresh_token: string;
  encrypted_project_token?: string | null;
  encrypted_project_refresh_token?: string | null;
  selection_revision: number; full_sync_started_at: string | null;
  last_synced_at: string | null; last_full_sync_at: string | null; next_retry_at: string | null
}
type Repo = { id: number; full_name: string; html_url: string; description: string | null; private: boolean }
type WorkItem = { id: number; node_id?: string; number: number; title: string; html_url: string; state: string; updated_at: string; draft?: boolean;
  user?: { login: string }; assignees?: { login: string }[]; requested_reviewers?: { login: string }[];
  labels?: { name: string }[]; milestone?: { title: string }; pull_request?: unknown }

const now = () => new Date().toISOString()
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
const repoPath = (repo: Repo) => `/repos/${repo.full_name.split('/').map(encodeURIComponent).join('/')}`

async function listInstallationRepos(token: string): Promise<Repo[]> {
  const repos: Repo[] = []
  for (let page = 1; page <= 20; page++) {
    const { data } = await githubFetch<{ repositories: Repo[] }>(token, `/installation/repositories?per_page=100&page=${page}`)
    if (!Array.isArray(data.repositories)) throw new GitHubError(502, 'github_invalid_response', 'Invalid repository list')
    repos.push(...data.repositories)
    if (data.repositories.length < 100) return repos
  }
  throw new GitHubError(502, 'github_page_limit', 'Too many installation repositories')
}

async function updateRepos(env: GitHubEnv, connection: Connection, token: string): Promise<Repo[]> {
  const repos = await listInstallationRepos(token)
  const ids = JSON.stringify(repos.map((repo) => repo.id))
  const available = new Set(repos.map((repo) => repo.id))
  const { results: previous } = await env.DB.prepare('SELECT repo_id FROM github_repositories WHERE connection_id = ?')
    .bind(connection.id).all<{ repo_id: number }>()
  if (previous.some((row) => !available.has(row.repo_id))) {
    await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ?').bind(connection.id).run()
  }
  for (const table of ['github_items', 'github_labels', 'github_milestones', 'github_sync_progress']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE connection_id = ? AND repo_id NOT IN (SELECT value FROM json_each(?))`)
      .bind(connection.id, ids).run()
  }
  await env.DB.prepare('DELETE FROM github_repositories WHERE connection_id = ? AND repo_id NOT IN (SELECT value FROM json_each(?))')
    .bind(connection.id, ids).run()
  for (let offset = 0; offset < repos.length; offset += 100) {
    const rows = repos.slice(offset, offset + 100).map((repo) => [connection.id, repo.id, repo.full_name, repo.html_url,
      repo.description, repo.private ? 1 : 0, now()])
    await env.DB.prepare(`INSERT INTO github_repositories
      (connection_id, repo_id, full_name, html_url, description, private, selected, access_available, updated_at)
      SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
        json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),
        0,1,json_extract(value,'$[6]') FROM json_each(?) WHERE true
      ON CONFLICT(connection_id, repo_id) DO UPDATE SET full_name=excluded.full_name,
        html_url=excluded.html_url, description=excluded.description, private=excluded.private,
        access_available=1, updated_at=excluded.updated_at`).bind(JSON.stringify(rows)).run()
  }
  return repos
}

async function reviewDecisions(token: string, pulls: WorkItem[]): Promise<Map<number, { decision: string | null; requested: string[] }>> {
  const result = new Map<number, { decision: string | null; requested: string[] }>()
  const ids = pulls.filter((pull) => pull.state === 'open' && pull.node_id).map((pull) => pull.node_id!)
  for (let offset = 0; offset < ids.length; offset += 50) {
    const data = await graphql<{ nodes: ({ number: number; reviewDecision: string | null; reviewRequests: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] } } | null)[] }>(token,
      `query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{number reviewDecision reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{slug}}}}}}}`, { ids: ids.slice(offset, offset + 50) })
    for (const pull of data.nodes.filter((item) => item !== null)) result.set(pull!.number, {
      decision: pull!.reviewDecision, requested: pull!.reviewRequests.nodes.map((node) => node.requestedReviewer?.login || node.requestedReviewer?.slug || '').filter(Boolean),
    })
  }
  return result
}

async function upsertItems(env: GitHubEnv, connection: Connection, repo: Repo, items: WorkItem[], kind: 'issue' | 'pull_request', generation: string,
  reviews: Map<number, { decision: string | null; requested: string[] }> = new Map()) {
  for (let offset = 0; offset < items.length; offset += 100) {
    const rows = items.slice(offset, offset + 100).map((item) => {
      const review = reviews.get(item.number)
      return [connection.id, repo.id, kind, item.id, item.number, item.title, item.html_url, item.state,
        item.draft ? 1 : 0, item.user?.login || null, JSON.stringify(item.assignees?.map((user) => user.login) || []),
        JSON.stringify(review?.requested || item.requested_reviewers?.map((user) => user.login) || []),
        JSON.stringify(item.labels?.map((label) => label.name) || []), item.milestone?.title || null,
        review?.decision || null, item.updated_at, connection.context === 'work' ? 1 : 0, generation]
    })
    const columns = rows[0].map((_, index) => `json_extract(value, '$[${index}]')`).join(', ')
    await env.DB.prepare(`INSERT INTO github_items
    (connection_id, repo_id, kind, github_id, number, title, html_url, state, draft, author_login,
     assignees_json, requested_reviewers_json, labels_json, milestone_title, review_state, github_updated_at, sensitive, sync_generation)
    SELECT ${columns} FROM json_each(?) WHERE EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)
    ON CONFLICT(connection_id, kind, github_id) DO UPDATE SET
    title=excluded.title, html_url=excluded.html_url, state=excluded.state, draft=excluded.draft,
    author_login=excluded.author_login, assignees_json=excluded.assignees_json,
    requested_reviewers_json=excluded.requested_reviewers_json, labels_json=excluded.labels_json,
    milestone_title=excluded.milestone_title, review_state=excluded.review_state,
    github_updated_at=excluded.github_updated_at, sync_generation=excluded.sync_generation`)
      .bind(JSON.stringify(rows), connection.id, repo.id, connection.selection_revision).run()
  }
}

async function recentPulls(token: string, path: string, since: string | null): Promise<WorkItem[]> {
  if (!since) return githubPages<WorkItem>(token, `${path}/pulls?state=all&sort=updated&direction=desc&per_page=100`)
  const pulls: WorkItem[] = []
  for (let page = 1; page <= 20; page++) {
    const { data } = await githubFetch<WorkItem[]>(token, `${path}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`)
    if (!Array.isArray(data)) throw new GitHubError(502, 'github_invalid_response', 'Invalid pull request list')
    pulls.push(...data.filter((pull) => pull.updated_at >= since))
    if (data.length < 100 || data.some((pull) => pull.updated_at < since)) return pulls
  }
  throw new GitHubError(502, 'github_page_limit', 'Too many recently updated pull requests')
}

type SyncBudget = { pages: number }

async function saveFullProgress(env: GitHubEnv, connection: Connection, repo: Repo,
  kind: 'issue' | 'pull_request', nextUrl: string, generation: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO github_sync_progress
    (connection_id, repo_id, kind, next_url, generation, started_at, selection_revision)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)
    ON CONFLICT(connection_id, repo_id, kind) DO UPDATE SET next_url=excluded.next_url,
      generation=excluded.generation, started_at=excluded.started_at, selection_revision=excluded.selection_revision`)
    .bind(connection.id, repo.id, kind, nextUrl, generation, connection.full_sync_started_at || now(), connection.selection_revision,
      connection.id, repo.id, connection.selection_revision).run()
}

export async function scanFullList(env: GitHubEnv, connection: Connection, repo: Repo, token: string,
  kind: 'issue' | 'pull_request', budget: SyncBudget): Promise<boolean> {
  const progress = await env.DB.prepare(`SELECT next_url, generation FROM github_sync_progress
    WHERE connection_id = ? AND repo_id = ? AND kind = ? AND selection_revision = ?`)
    .bind(connection.id, repo.id, kind, connection.selection_revision)
    .first<{ next_url: string; generation: string }>()
  if (progress?.next_url === '') return true
  let next: string | null = progress?.next_url || `${repoPath(repo)}/${kind === 'issue' ? 'issues' : 'pulls'}?state=all&sort=created&direction=asc&per_page=100`
  const generation = progress?.generation || crypto.randomUUID()
  while (next && budget.pages > 0) {
    if (!await currentSelection(env, connection)) return false
    const fetched: { data: WorkItem[]; response: Response } = await githubFetch<WorkItem[]>(token, next)
    const { data, response } = fetched
    if (!Array.isArray(data)) throw new GitHubError(502, 'github_invalid_response', 'GitHub returned an invalid list')
    const reviews = kind === 'pull_request' ? await reviewDecisions(token, data) : new Map<number, { decision: string | null; requested: string[] }>()
    await upsertItems(env, connection, repo, kind === 'issue' ? data.filter((item) => !item.pull_request) : data, kind, generation, reviews)
    const match: RegExpMatchArray | null = (response.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/)
    next = match?.[1] || null
    budget.pages--
    if (next) await saveFullProgress(env, connection, repo, kind, next, generation)
  }
  if (next) return false
  await env.DB.prepare(`DELETE FROM github_items WHERE connection_id = ? AND repo_id = ? AND kind = ?
    AND sync_generation != ? AND EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)`)
    .bind(connection.id, repo.id, kind, generation, connection.id, repo.id, connection.selection_revision).run()
  await saveFullProgress(env, connection, repo, kind, '', generation)
  return true
}

async function syncRepo(env: GitHubEnv, connection: Connection, repo: Repo, token: string, full: boolean, budget: SyncBudget): Promise<boolean> {
  const path = repoPath(repo)
  if (!await currentSelection(env, connection)) return false
  if (full) {
    if (!await scanFullList(env, connection, repo, token, 'issue', budget)) return false
    if (!await scanFullList(env, connection, repo, token, 'pull_request', budget)) return false
  } else {
    const since = connection.last_synced_at ? new Date(Date.parse(connection.last_synced_at) - 120_000).toISOString() : null
    const issues = await githubPages<WorkItem>(token, `${path}/issues?state=all&per_page=100${since ? `&since=${encodeURIComponent(since)}` : ''}`)
    const pulls = await recentPulls(token, path, since)
    await upsertItems(env, connection, repo, issues.filter((item) => !item.pull_request), 'issue', crypto.randomUUID())
    await upsertItems(env, connection, repo, pulls, 'pull_request', crypto.randomUUID(), await reviewDecisions(token, pulls))
  }

  const milestones = await githubPages<{ id: number; title: string; state: string; due_on: string | null; open_issues: number; closed_issues: number; html_url: string }>(token, `${path}/milestones?state=all&per_page=100`)
  const labels = await githubPages<{ id: number; name: string; color: string }>(token, `${path}/labels?per_page=100`)
  for (const table of ['github_milestones', 'github_labels']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE connection_id = ? AND repo_id = ? AND EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)`)
      .bind(connection.id, repo.id, connection.id, repo.id, connection.selection_revision).run()
  }
  if (milestones.length) await env.DB.prepare(`INSERT INTO github_milestones
    (connection_id, repo_id, github_id, title, state, due_on, open_issues, closed_issues, html_url)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
      json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),
      json_extract(value,'$[6]'),json_extract(value,'$[7]'),json_extract(value,'$[8]') FROM json_each(?) WHERE EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)`)
    .bind(JSON.stringify(milestones.map((item) => [connection.id, repo.id, item.id, item.title, item.state,
      item.due_on, item.open_issues, item.closed_issues, item.html_url])), connection.id, repo.id, connection.selection_revision).run()
  if (labels.length) await env.DB.prepare(`INSERT INTO github_labels (connection_id, repo_id, github_id, name, color)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
      json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?) WHERE EXISTS (
      SELECT 1 FROM github_repositories r JOIN github_connections c ON c.id = r.connection_id
      WHERE r.connection_id = ? AND r.repo_id = ? AND r.selected = 1 AND c.selection_revision = ?)`)
    .bind(JSON.stringify(labels.map((item) => [connection.id, repo.id, item.id, item.name, item.color])),
      connection.id, repo.id, connection.selection_revision).run()
  return true
}

type ProjectReference = { id: string; content: { repository?: { fullDatabaseId: string } } | null }
type ProjectItem = { id: string; content: { title?: string; url?: string } | null; fieldValues: { nodes: unknown[] } }

export async function syncProjects(env: GitHubEnv, connection: Connection, userToken: string, allowedRepos: Set<number>): Promise<void> {
  const ownerType = connection.account_type === 'Organization' ? 'organization' : 'user'
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const data: Record<string, { projectsV2: { nodes: { id: string; number: number }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }> = await graphql(userToken,
      `query($login:String!,$cursor:String){${ownerType}(login:$login){projectsV2(first:100,after:$cursor){nodes{id number} pageInfo{hasNextPage endCursor}}}}`,
      { login: connection.account_login, cursor })
    const projects = data[ownerType]?.projectsV2
    if (!projects) throw new GitHubError(403, 'github_projects_unavailable', 'Projects access is unavailable')
    for (const project of projects.nodes) {
      let itemCursor: string | null = null
      const matchingIds: string[] = []
      for (let itemPage = 0; itemPage < 20; itemPage++) {
        if (!await currentSelection(env, connection)) return
        const detail: { node: { items: { nodes: ProjectReference[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await graphql(userToken,
          `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{repository{fullDatabaseId}} ... on PullRequest{repository{fullDatabaseId}}}} pageInfo{hasNextPage endCursor}}}}}`, { id: project.id, cursor: itemCursor })
        if (!detail.node) throw new GitHubError(403, 'github_projects_unavailable', 'A project is unavailable')
        for (const item of detail.node.items.nodes) if (item.content?.repository && allowedRepos.has(Number(item.content.repository.fullDatabaseId))) {
          matchingIds.push(item.id)
        }
        if (!detail.node.items.pageInfo.hasNextPage) break
        itemCursor = detail.node.items.pageInfo.endCursor
        if (itemPage === 19) throw new GitHubError(502, 'github_page_limit', 'Project has too many items')
      }
      if (matchingIds.length) {
        if (!await currentSelection(env, connection)) return
        const metadata = await graphql<{ node: { title: string; url: string; fields: { nodes: unknown[] } } }>(userToken,
          `query($id:ID!){node(id:$id){... on ProjectV2{title url fields(first:100){nodes{... on ProjectV2FieldCommon{id name}}}}}}`, { id: project.id })
        if (!metadata.node) throw new GitHubError(403, 'github_projects_unavailable', 'A project is unavailable')
        const items: { title: string; url: string; fields: unknown[] }[] = []
        for (let offset = 0; offset < matchingIds.length; offset += 50) {
          if (!await currentSelection(env, connection)) return
          const details = await graphql<{ nodes: (ProjectItem | null)[] }>(userToken,
            `query($ids:[ID!]!){nodes(ids:$ids){... on ProjectV2Item{id content{... on Issue{title url} ... on PullRequest{title url}} fieldValues(first:20){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}} ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{name}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}}}}}}`,
            { ids: matchingIds.slice(offset, offset + 50) })
          for (const item of details.nodes) if (item?.content) items.push({
            title: item.content.title || '', url: item.content.url || '', fields: item.fieldValues.nodes,
          })
        }
        seen.add(project.id)
        await env.DB.prepare(`INSERT INTO github_projects (connection_id, node_id, number, title, html_url, fields_json, items_json, sensitive)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM github_connections WHERE id = ? AND selection_revision = ?)
          ON CONFLICT(connection_id, node_id) DO UPDATE SET
          number=excluded.number, title=excluded.title, html_url=excluded.html_url,
          fields_json=excluded.fields_json, items_json=excluded.items_json, sensitive=excluded.sensitive`)
          .bind(connection.id, project.id, project.number, metadata.node.title, metadata.node.url,
            JSON.stringify(metadata.node.fields.nodes), JSON.stringify(items), connection.context === 'work' ? 1 : 0,
            connection.id, connection.selection_revision).run()
      }
    }
    if (!projects.pageInfo.hasNextPage) break
    cursor = projects.pageInfo.endCursor
    if (page === 19) throw new GitHubError(502, 'github_page_limit', 'Too many Projects')
  }
  const { results: old } = await env.DB.prepare('SELECT node_id FROM github_projects WHERE connection_id = ?').bind(connection.id).all<{ node_id: string }>()
  for (const row of old) if (!seen.has(row.node_id)) await env.DB.prepare(`DELETE FROM github_projects
    WHERE connection_id = ? AND node_id = ? AND EXISTS (
      SELECT 1 FROM github_connections WHERE id = ? AND selection_revision = ?)`)
    .bind(connection.id, row.node_id, connection.id, connection.selection_revision).run()
}

export async function purgeConnection(env: GitHubEnv, id: string): Promise<void> {
  for (const table of ['github_items', 'github_milestones', 'github_labels', 'github_projects', 'github_sync_progress', 'github_repositories']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE connection_id = ?`).bind(id).run()
  }
  await env.DB.prepare('DELETE FROM github_connections WHERE id = ?').bind(id).run()
}

async function currentSelection(env: GitHubEnv, connection: Connection): Promise<boolean> {
  const row = await env.DB.prepare('SELECT selection_revision FROM github_connections WHERE id = ?')
    .bind(connection.id).first<{ selection_revision: number }>()
  return row?.selection_revision === connection.selection_revision
}

async function personalProjectToken(env: GitHubEnv, connection: Connection): Promise<string> {
  if (!connection.encrypted_project_refresh_token) {
    throw new GitHubError(401, 'github_projects_authorization_expired', 'Reauthorize personal Projects')
  }
  const refreshed = await refreshProjectToken(env, await unseal(env, connection.encrypted_project_refresh_token))
  const updated = await env.DB.prepare(`UPDATE github_connections SET encrypted_project_token = ?,
    encrypted_project_refresh_token = ?, project_refresh_expires_at = ?, updated_at = ?
    WHERE id = ? AND encrypted_project_refresh_token = ?`)
    .bind(await seal(env, refreshed.access_token), await seal(env, refreshed.refresh_token),
      later(refreshed.refresh_token_expires_in), now(), connection.id, connection.encrypted_project_refresh_token).run()
  if (!updated.meta.changes) throw new GitHubError(409, 'github_projects_token_changed', 'Projects authorization changed during sync')
  return refreshed.access_token
}

export async function syncConnection(env: GitHubEnv, connection: Connection): Promise<void> {
  if (connection.next_retry_at && connection.next_retry_at > now()) return
  const leaseId = crypto.randomUUID()
  const acquired = await env.DB.prepare(`UPDATE github_connections SET sync_lease_id = ?, sync_lease_until = ?
    WHERE id = ? AND (sync_lease_until IS NULL OR sync_lease_until < ?)`)
    .bind(leaseId, later(900), connection.id, now()).run()
  if (!acquired.meta.changes) return
  try {
    const latest = await env.DB.prepare('SELECT * FROM github_connections WHERE id = ?').bind(connection.id).first<Connection>()
    if (!latest) return
    connection = latest
    const user = await refreshUserToken(env, await unseal(env, connection.encrypted_refresh_token))
    await env.DB.prepare('UPDATE github_connections SET encrypted_refresh_token = ?, refresh_expires_at = ?, updated_at = ? WHERE id = ?')
      .bind(await seal(env, user.refresh_token), later(user.refresh_token_expires_in), now(), connection.id).run()
    const installations = await userInstallations<{ id: number }>(user.access_token)
    if (!installations.some((item) => item.id === connection.installation_id)) return purgeConnection(env, connection.id)
    const token = await installationToken(env, connection.installation_id)
    const repos = await updateRepos(env, connection, token)
    const { results: selected } = await env.DB.prepare('SELECT repo_id FROM github_repositories WHERE connection_id = ? AND selected = 1').bind(connection.id).all<{ repo_id: number }>()
    const selectedIds = new Set(selected.map((row) => row.repo_id))
    const full = !connection.last_full_sync_at || Date.now() - Date.parse(connection.last_full_sync_at) > 7 * 86400_000
    if (full && !connection.full_sync_started_at) {
      connection.full_sync_started_at = now()
      await env.DB.prepare('UPDATE github_connections SET full_sync_started_at = ? WHERE id = ? AND selection_revision = ?')
        .bind(connection.full_sync_started_at, connection.id, connection.selection_revision).run()
    }
    const budget: SyncBudget = { pages: 6 }
    let fullComplete = true
    for (const repo of repos.filter((item) => selectedIds.has(item.id))) {
      if (full && budget.pages === 0) { fullComplete = false; break }
      if (!await syncRepo(env, connection, repo, token, full, budget)) fullComplete = false
      if (!await currentSelection(env, connection)) return
    }
    if (!await currentSelection(env, connection)) return
    let projectsError: string | null = null
    if (selectedIds.size && fullComplete) {
      if (connection.context === 'personal' && !connection.encrypted_project_token) {
        projectsError = 'personal_projects_not_authorized'
        await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ? AND EXISTS (SELECT 1 FROM github_connections WHERE id = ? AND selection_revision = ?)')
          .bind(connection.id, connection.id, connection.selection_revision).run()
      }
      else {
        try {
          const projectToken = connection.context === 'personal' ? await personalProjectToken(env, connection) : user.access_token
          await syncProjects(env, connection, projectToken, selectedIds)
        } catch (error) {
          projectsError = error instanceof GitHubError ? error.code : 'github_projects_sync_failed'
          if (['access_revoked', 'github_projects_authorization_expired', 'github_projects_unavailable'].includes(projectsError)) {
            await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ? AND EXISTS (SELECT 1 FROM github_connections WHERE id = ? AND selection_revision = ?)')
              .bind(connection.id, connection.id, connection.selection_revision).run()
            if (connection.context === 'personal' && projectsError !== 'github_projects_unavailable') {
              await env.DB.prepare(`UPDATE github_connections SET encrypted_project_token = NULL,
                encrypted_project_refresh_token = NULL, project_refresh_expires_at = NULL WHERE id = ?`)
                .bind(connection.id).run()
            }
          }
        }
      }
    } else if (!selectedIds.size) await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ? AND EXISTS (SELECT 1 FROM github_connections WHERE id = ? AND selection_revision = ?)')
      .bind(connection.id, connection.id, connection.selection_revision).run()
    if (!await currentSelection(env, connection)) return
    const timestamp = now()
    await env.DB.prepare(`UPDATE github_connections SET status = 'ready', error_code = NULL, projects_error_code = ?, next_retry_at = NULL,
      last_synced_at = ?, last_full_sync_at = ?, full_sync_started_at = ?, updated_at = ?
      WHERE id = ? AND selection_revision = ?`)
      .bind(projectsError, full && !fullComplete ? connection.last_synced_at : full ? connection.full_sync_started_at : timestamp,
        full && fullComplete ? timestamp : connection.last_full_sync_at,
        full && !fullComplete ? connection.full_sync_started_at : null, timestamp, connection.id, connection.selection_revision).run()
    if (full && fullComplete) await env.DB.prepare('DELETE FROM github_sync_progress WHERE connection_id = ? AND selection_revision = ?')
      .bind(connection.id, connection.selection_revision).run()
  } catch (error) {
    if (error instanceof GitHubError && ['access_revoked', 'github_user_authorization_expired'].includes(error.code)) return purgeConnection(env, connection.id)
    const code = error instanceof GitHubError ? error.code : 'github_sync_failed'
    const status = code === 'approval_required' || code === 'github_projects_unavailable' ? 'approval_required' : 'error'
    await env.DB.prepare('UPDATE github_connections SET status = ?, error_code = ?, next_retry_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, code, error instanceof GitHubError ? error.retryAt || null : null, now(), connection.id).run()
  } finally {
    await env.DB.prepare('UPDATE github_connections SET sync_lease_id = NULL, sync_lease_until = NULL WHERE id = ? AND sync_lease_id = ?')
      .bind(connection.id, leaseId).run()
  }
}

export async function discoverRepositories(env: GitHubEnv, connection: Connection): Promise<void> {
  await updateRepos(env, connection, await installationToken(env, connection.installation_id))
}

export async function syncAllConnections(env: GitHubEnv): Promise<void> {
  if (!env.GITHUB_APP_ID) return
  const { results } = await env.DB.prepare('SELECT * FROM github_connections').all<Connection>()
  for (const connection of results) await syncConnection(env, connection)
  await env.DB.prepare('DELETE FROM github_oauth_flows WHERE expires_at < ?').bind(now()).run()
  await env.DB.prepare('DELETE FROM github_pending_links WHERE expires_at < ?').bind(now()).run()
  await env.DB.prepare('DELETE FROM github_project_oauth_flows WHERE expires_at < ?').bind(now()).run()
}
