import { githubFetch, githubPages, graphql, installationToken, refreshUserToken, seal, unseal, userInstallations, GitHubError, type GitHubEnv } from './githubApi'

export type Connection = {
  id: string; owner_id: string; context: 'personal' | 'work'; installation_id: number;
  account_login: string; account_type: 'User' | 'Organization'; encrypted_refresh_token: string;
  encrypted_project_token?: string | null;
  last_synced_at: string | null; last_full_sync_at: string | null; next_retry_at: string | null
}
type Repo = { id: number; full_name: string; html_url: string; description: string | null; private: boolean }
type WorkItem = { id: number; number: number; title: string; html_url: string; state: string; updated_at: string; draft?: boolean;
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
  for (const table of ['github_items', 'github_labels', 'github_milestones']) {
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

async function reviewDecisions(token: string, repo: Repo): Promise<Map<number, { decision: string | null; requested: string[] }>> {
  const [owner, name] = repo.full_name.split('/')
  const result = new Map<number, { decision: string | null; requested: string[] }>()
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const data: { repository: { pullRequests: { nodes: { number: number; reviewDecision: string | null; reviewRequests: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await graphql(token,
      `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$cursor,states:OPEN){nodes{number reviewDecision reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{slug}}}}} pageInfo{hasNextPage endCursor}}}}`,
      { owner, name, cursor })
    for (const pull of data.repository.pullRequests.nodes) result.set(pull.number, {
      decision: pull.reviewDecision, requested: pull.reviewRequests.nodes.map((node) => node.requestedReviewer?.login || node.requestedReviewer?.slug || '').filter(Boolean),
    })
    if (!data.repository.pullRequests.pageInfo.hasNextPage) return result
    cursor = data.repository.pullRequests.pageInfo.endCursor
  }
  throw new GitHubError(502, 'github_page_limit', 'Too many open pull requests')
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
    SELECT ${columns} FROM json_each(?) WHERE true
    ON CONFLICT(connection_id, kind, github_id) DO UPDATE SET
    title=excluded.title, html_url=excluded.html_url, state=excluded.state, draft=excluded.draft,
    author_login=excluded.author_login, assignees_json=excluded.assignees_json,
    requested_reviewers_json=excluded.requested_reviewers_json, labels_json=excluded.labels_json,
    milestone_title=excluded.milestone_title, review_state=excluded.review_state,
    github_updated_at=excluded.github_updated_at, sync_generation=excluded.sync_generation`)
      .bind(JSON.stringify(rows)).run()
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

async function syncRepo(env: GitHubEnv, connection: Connection, repo: Repo, token: string, full: boolean, generation: string): Promise<void> {
  const path = repoPath(repo)
  const since = !full && connection.last_synced_at ? new Date(Date.parse(connection.last_synced_at) - 120_000).toISOString() : null
  const issues = await githubPages<WorkItem>(token, `${path}/issues?state=all&per_page=100${since ? `&since=${encodeURIComponent(since)}` : ''}`)
  const pulls = await recentPulls(token, path, since)
  const reviews = await reviewDecisions(token, repo)
  await upsertItems(env, connection, repo, issues.filter((item) => !item.pull_request), 'issue', generation)
  await upsertItems(env, connection, repo, pulls, 'pull_request', generation, reviews)
  if (full) await env.DB.prepare('DELETE FROM github_items WHERE connection_id = ? AND repo_id = ? AND sync_generation != ?').bind(connection.id, repo.id, generation).run()

  const milestones = await githubPages<{ id: number; title: string; state: string; due_on: string | null; open_issues: number; closed_issues: number; html_url: string }>(token, `${path}/milestones?state=all&per_page=100`)
  const labels = await githubPages<{ id: number; name: string; color: string }>(token, `${path}/labels?per_page=100`)
  await env.DB.prepare('DELETE FROM github_milestones WHERE connection_id = ? AND repo_id = ?').bind(connection.id, repo.id).run()
  await env.DB.prepare('DELETE FROM github_labels WHERE connection_id = ? AND repo_id = ?').bind(connection.id, repo.id).run()
  if (milestones.length) await env.DB.prepare(`INSERT INTO github_milestones
    (connection_id, repo_id, github_id, title, state, due_on, open_issues, closed_issues, html_url)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
      json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),
      json_extract(value,'$[6]'),json_extract(value,'$[7]'),json_extract(value,'$[8]') FROM json_each(?)`)
    .bind(JSON.stringify(milestones.map((item) => [connection.id, repo.id, item.id, item.title, item.state,
      item.due_on, item.open_issues, item.closed_issues, item.html_url]))).run()
  if (labels.length) await env.DB.prepare(`INSERT INTO github_labels (connection_id, repo_id, github_id, name, color)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
      json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?)`)
    .bind(JSON.stringify(labels.map((item) => [connection.id, repo.id, item.id, item.name, item.color]))).run()
}

type ProjectItem = { content: { title?: string; url?: string; repository?: { fullDatabaseId: string } } | null; fieldValues: { nodes: unknown[] } }

async function syncProjects(env: GitHubEnv, connection: Connection, userToken: string, allowedRepos: Set<number>): Promise<void> {
  const ownerType = connection.account_type === 'Organization' ? 'organization' : 'user'
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const data: Record<string, { projectsV2: { nodes: { id: string; number: number; title: string; url: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }> = await graphql(userToken,
      `query($login:String!,$cursor:String){${ownerType}(login:$login){projectsV2(first:100,after:$cursor){nodes{id number title url} pageInfo{hasNextPage endCursor}}}}`,
      { login: connection.account_login, cursor })
    const projects = data[ownerType]?.projectsV2
    if (!projects) throw new GitHubError(403, 'github_projects_unavailable', 'Projects access is unavailable')
    for (const project of projects.nodes) {
      let itemCursor: string | null = null
      let fields: unknown[] = []
      const items: { title: string; url: string; fields: unknown[] }[] = []
      for (let itemPage = 0; itemPage < 20; itemPage++) {
        const detail: { node: { fields: { nodes: unknown[] }; items: { nodes: ProjectItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await graphql(userToken,
          `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{fields(first:100){nodes{... on ProjectV2FieldCommon{id name}}} items(first:100,after:$cursor){nodes{content{... on Issue{title url repository{fullDatabaseId}} ... on PullRequest{title url repository{fullDatabaseId}}} fieldValues(first:20){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}} ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{name}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}}}} pageInfo{hasNextPage endCursor}}}}}`, { id: project.id, cursor: itemCursor })
        if (!detail.node) throw new GitHubError(403, 'github_projects_unavailable', 'A project is unavailable')
        fields = detail.node.fields.nodes
        for (const item of detail.node.items.nodes) if (item.content?.repository && allowedRepos.has(Number(item.content.repository.fullDatabaseId))) {
          items.push({ title: item.content.title || '', url: item.content.url || '', fields: item.fieldValues.nodes })
        }
        if (!detail.node.items.pageInfo.hasNextPage) break
        itemCursor = detail.node.items.pageInfo.endCursor
        if (itemPage === 19) throw new GitHubError(502, 'github_page_limit', 'Project has too many items')
      }
      if (items.length) {
        seen.add(project.id)
        await env.DB.prepare(`INSERT INTO github_projects (connection_id, node_id, number, title, html_url, fields_json, items_json, sensitive)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_id, node_id) DO UPDATE SET
          number=excluded.number, title=excluded.title, html_url=excluded.html_url,
          fields_json=excluded.fields_json, items_json=excluded.items_json, sensitive=excluded.sensitive`)
          .bind(connection.id, project.id, project.number, project.title, project.url, JSON.stringify(fields), JSON.stringify(items), connection.context === 'work' ? 1 : 0).run()
      }
    }
    if (!projects.pageInfo.hasNextPage) break
    cursor = projects.pageInfo.endCursor
    if (page === 19) throw new GitHubError(502, 'github_page_limit', 'Too many Projects')
  }
  const { results: old } = await env.DB.prepare('SELECT node_id FROM github_projects WHERE connection_id = ?').bind(connection.id).all<{ node_id: string }>()
  for (const row of old) if (!seen.has(row.node_id)) await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ? AND node_id = ?').bind(connection.id, row.node_id).run()
}

export async function purgeConnection(env: GitHubEnv, id: string): Promise<void> {
  for (const table of ['github_items', 'github_milestones', 'github_labels', 'github_projects', 'github_repositories']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE connection_id = ?`).bind(id).run()
  }
  await env.DB.prepare('DELETE FROM github_connections WHERE id = ?').bind(id).run()
}

export async function syncConnection(env: GitHubEnv, connection: Connection): Promise<void> {
  if (connection.next_retry_at && connection.next_retry_at > now()) return
  try {
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
    const generation = crypto.randomUUID()
    for (const repo of repos.filter((item) => selectedIds.has(item.id))) await syncRepo(env, connection, repo, token, full, generation)
    let projectsError: string | null = null
    if (selectedIds.size) {
      if (connection.context === 'personal' && !connection.encrypted_project_token) {
        projectsError = 'personal_projects_not_authorized'
        await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ?').bind(connection.id).run()
      }
      else {
        try {
          const projectToken = connection.context === 'personal' ? await unseal(env, connection.encrypted_project_token!) : user.access_token
          await syncProjects(env, connection, projectToken, selectedIds)
        } catch (error) {
          projectsError = error instanceof GitHubError ? error.code : 'github_projects_sync_failed'
          if (projectsError === 'access_revoked' || projectsError === 'github_projects_unavailable') {
            await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ?').bind(connection.id).run()
            if (connection.context === 'personal' && projectsError === 'access_revoked') {
              await env.DB.prepare('UPDATE github_connections SET encrypted_project_token = NULL WHERE id = ?').bind(connection.id).run()
            }
          }
        }
      }
    } else await env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ?').bind(connection.id).run()
    const timestamp = now()
    await env.DB.prepare(`UPDATE github_connections SET status = 'ready', error_code = NULL, projects_error_code = ?, next_retry_at = NULL,
      last_synced_at = ?, last_full_sync_at = ?, updated_at = ? WHERE id = ?`)
      .bind(projectsError, timestamp, full ? timestamp : connection.last_full_sync_at, timestamp, connection.id).run()
  } catch (error) {
    if (error instanceof GitHubError && ['access_revoked', 'github_user_authorization_expired'].includes(error.code)) return purgeConnection(env, connection.id)
    const code = error instanceof GitHubError ? error.code : 'github_sync_failed'
    const status = code === 'approval_required' || code === 'github_projects_unavailable' ? 'approval_required' : 'error'
    await env.DB.prepare('UPDATE github_connections SET status = ?, error_code = ?, next_retry_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, code, error instanceof GitHubError ? error.retryAt || null : null, now(), connection.id).run()
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
