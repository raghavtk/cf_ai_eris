import { configured, exchangeCode, exchangeProjectCode, githubFetch, installationToken, randomState, seal, unseal, userInstallations, GitHubError, type GitHubEnv } from './githubApi'
import { discoverRepositories, purgeConnection, syncConnection, type Connection } from './sync'

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const errorResponse = (status: number, code: string, error: string, headers: Record<string, string>) => json({ code, error }, status, headers)
const expires = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const now = () => new Date().toISOString()
const isContext = (value: unknown): value is 'personal' | 'work' => value === 'personal' || value === 'work'
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

async function connectionFor(env: GitHubEnv, owner: string, id: string): Promise<Connection | null> {
  return env.DB.prepare('SELECT * FROM github_connections WHERE id = ? AND owner_id = ?').bind(id, owner).first<Connection>()
}

function returnToApp(env: GitHubEnv, params: Record<string, string>): Response {
  const url = new URL('/github', env.ERIS_ALLOWED_ORIGIN)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

type Installation = { id: number; account: { id: number; login: string; type: string }; suspended_at: string | null; repository_selection: string }

export async function handleGitHubRequest(request: Request, env: GitHubEnv, owner: string, headers: Record<string, string>): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  if (!path.startsWith('/api/github/')) return null
  if (!configured(env)) return errorResponse(503, 'github_not_configured', 'GitHub connector is not configured', headers)
  try {
    if (path === '/api/github/config' && request.method === 'GET') {
      return json({ install_url: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
        personal_projects_available: !!(env.GITHUB_PROJECT_OAUTH_CLIENT_ID && env.GITHUB_PROJECT_OAUTH_CLIENT_SECRET) }, 200, headers)
    }
    if (path === '/api/github/projects/start' && request.method === 'POST') {
      if (!env.GITHUB_PROJECT_OAUTH_CLIENT_ID || !env.GITHUB_PROJECT_OAUTH_CLIENT_SECRET) {
        return errorResponse(503, 'github_projects_not_configured', 'Personal Projects authorization is not configured', headers)
      }
      const input = await body(request)
      if (!isId(input.connection_id)) return errorResponse(400, 'invalid_connection', 'Choose a connection', headers)
      const connection = await connectionFor(env, owner, input.connection_id)
      if (!connection || connection.context !== 'personal') return errorResponse(404, 'connection_not_found', 'Personal connection not found', headers)
      const state = randomState()
      await env.DB.prepare('INSERT INTO github_project_oauth_flows (state, owner_id, connection_id, expires_at) VALUES (?, ?, ?, ?)')
        .bind(state, owner, connection.id, expires(10)).run()
      const auth = new URL('https://github.com/login/oauth/authorize')
      auth.searchParams.set('client_id', env.GITHUB_PROJECT_OAUTH_CLIENT_ID)
      auth.searchParams.set('redirect_uri', `${url.origin}/api/github/projects/callback`)
      auth.searchParams.set('scope', 'read:project')
      auth.searchParams.set('state', state)
      return json({ authorization_url: auth.toString() }, 200, headers)
    }
    if (path === '/api/github/projects/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || ''
      const flow = await env.DB.prepare('SELECT * FROM github_project_oauth_flows WHERE state = ?').bind(state)
        .first<{ owner_id: string; connection_id: string; expires_at: string }>()
      if (!flow || flow.owner_id !== owner || flow.expires_at < now() || !code) return returnToApp(env, { github_error: 'projects_authorization_invalid' })
      await env.DB.prepare('DELETE FROM github_project_oauth_flows WHERE state = ?').bind(state).run()
      const connection = await connectionFor(env, owner, flow.connection_id)
      if (!connection || connection.context !== 'personal') return returnToApp(env, { github_error: 'connection_unavailable' })
      try {
        const tokens = await exchangeProjectCode(env, code)
        const { data: user } = await githubFetch<{ id: number }>(tokens.access_token, '/user')
        const identity = await env.DB.prepare('SELECT github_user_id FROM github_connections WHERE id = ?').bind(connection.id).first<{ github_user_id: number }>()
        if (user.id !== identity?.github_user_id) return returnToApp(env, { github_error: 'projects_account_mismatch' })
        await env.DB.prepare(`UPDATE github_connections SET encrypted_project_token = ?, encrypted_project_refresh_token = ?,
          project_refresh_expires_at = ?, projects_error_code = NULL, updated_at = ? WHERE id = ?`)
          .bind(await seal(env, tokens.access_token), await seal(env, tokens.refresh_token),
            new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString(), now(), connection.id).run()
        return returnToApp(env, { github_projects: 'connected' })
      } catch { return returnToApp(env, { github_error: 'projects_authorization_failed' }) }
    }
    if (path === '/api/github/oauth/start' && request.method === 'POST') {
      const input = await body(request)
      if (!isContext(input.context)) return errorResponse(400, 'invalid_context', 'Choose personal or work', headers)
      const state = randomState()
      await env.DB.prepare('INSERT INTO github_oauth_flows (state, owner_id, context, expires_at) VALUES (?, ?, ?, ?)')
        .bind(state, owner, input.context, expires(10)).run()
      const auth = new URL('https://github.com/login/oauth/authorize')
      auth.searchParams.set('client_id', env.GITHUB_CLIENT_ID!)
      auth.searchParams.set('redirect_uri', `${url.origin}/api/github/oauth/callback`)
      auth.searchParams.set('state', state)
      return json({ authorization_url: auth.toString() }, 200, headers)
    }
    if (path === '/api/github/oauth/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || ''
      const flow = await env.DB.prepare('SELECT owner_id, context, expires_at FROM github_oauth_flows WHERE state = ?').bind(state).first<{ owner_id: string; context: 'personal' | 'work'; expires_at: string }>()
      if (!flow || flow.owner_id !== owner || flow.expires_at < now() || !code) return returnToApp(env, { github_error: 'authorization_invalid' })
      await env.DB.prepare('DELETE FROM github_oauth_flows WHERE state = ?').bind(state).run()
      try {
        const tokens = await exchangeCode(env, code)
        const { data: user } = await githubFetch<{ id: number; login: string }>(tokens.access_token, '/user')
        const pendingId = crypto.randomUUID()
        await env.DB.prepare(`INSERT INTO github_pending_links
          (id, owner_id, context, github_user_id, github_login, encrypted_access_token, encrypted_refresh_token,
           access_expires_at, refresh_expires_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(pendingId, owner, flow.context, user.id, user.login, await seal(env, tokens.access_token),
            await seal(env, tokens.refresh_token), new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString(), expires(10)).run()
        return returnToApp(env, { github_pending: pendingId })
      } catch { return returnToApp(env, { github_error: 'authorization_failed' }) }
    }
    if (path === '/api/github/pending' && request.method === 'GET') {
      const id = url.searchParams.get('id')
      if (!isId(id)) return errorResponse(400, 'invalid_pending_id', 'Invalid pending connection', headers)
      const pending = await env.DB.prepare('SELECT * FROM github_pending_links WHERE id = ? AND owner_id = ? AND expires_at > ?')
        .bind(id, owner, now()).first<{ context: string; github_login: string; encrypted_access_token: string }>()
      if (!pending) return errorResponse(404, 'pending_expired', 'Connection request expired; authorize again', headers)
      const installations = await userInstallations<Installation>(await unseal(env, pending.encrypted_access_token))
      return json({ context: pending.context, github_login: pending.github_login, installations: installations.map((item) => ({
        id: item.id, account: item.account, suspended: !!item.suspended_at, repository_selection: item.repository_selection,
      })) }, 200, headers)
    }
    if (path === '/api/github/connections' && request.method === 'POST') {
      const input = await body(request)
      if (!isId(input.pending_id) || !Number.isSafeInteger(input.installation_id) || Number(input.installation_id) <= 0) {
        return errorResponse(400, 'invalid_connection', 'Choose a valid installation', headers)
      }
      const pending = await env.DB.prepare('SELECT * FROM github_pending_links WHERE id = ? AND owner_id = ? AND expires_at > ?')
        .bind(input.pending_id, owner, now()).first<{ id: string; context: 'personal' | 'work'; github_user_id: number; github_login: string; encrypted_access_token: string; encrypted_refresh_token: string; refresh_expires_at: string }>()
      if (!pending) return errorResponse(404, 'pending_expired', 'Connection request expired; authorize again', headers)
      const userToken = await unseal(env, pending.encrypted_access_token)
      const installations = await userInstallations<Installation>(userToken)
      const installation = installations.find((item) => item.id === input.installation_id)
      if (!installation || installation.suspended_at) return errorResponse(403, 'installation_unavailable', 'Installation is not authorized for this GitHub user', headers)
      if ((pending.context === 'personal' && installation.account.type !== 'User') ||
        (pending.context === 'work' && installation.account.type !== 'Organization')) {
        return errorResponse(400, 'installation_context_mismatch', 'Choose an installation matching personal or work', headers)
      }
      const existing = await env.DB.prepare('SELECT id FROM github_connections WHERE installation_id = ?').bind(installation.id).first()
      if (existing) return errorResponse(409, 'installation_connected', 'This installation is already connected', headers)
      await installationToken(env, installation.id)
      const id = crypto.randomUUID()
      await env.DB.prepare(`INSERT INTO github_connections
        (id, owner_id, context, installation_id, account_id, account_login, account_type,
         github_user_id, github_login, encrypted_refresh_token, refresh_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, owner, pending.context, installation.id, installation.account.id, installation.account.login,
          installation.account.type, pending.github_user_id, pending.github_login,
          pending.encrypted_refresh_token, pending.refresh_expires_at, now(), now()).run()
      try {
        await discoverRepositories(env, { id, owner_id: owner, context: pending.context, installation_id: installation.id,
          account_login: installation.account.login, account_type: installation.account.type as 'User' | 'Organization',
          encrypted_refresh_token: pending.encrypted_refresh_token, selection_revision: 0, full_sync_started_at: null,
          last_synced_at: null, last_full_sync_at: null, next_retry_at: null })
      } catch (error) {
        await purgeConnection(env, id)
        throw error
      }
      await env.DB.prepare('DELETE FROM github_pending_links WHERE id = ?').bind(pending.id).run()
      return json({ id, context: pending.context, account_login: installation.account.login }, 201, headers)
    }
    if (path === '/api/github/connections' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT id, context, installation_id, account_id, account_login, account_type,
        github_login, status, error_code, projects_error_code, CASE WHEN encrypted_project_token IS NOT NULL THEN 1 ELSE 0 END AS projects_authorized,
        CASE WHEN full_sync_started_at IS NOT NULL THEN 1 ELSE 0 END AS sync_pending,
        last_synced_at, next_retry_at, created_at
        FROM github_connections WHERE owner_id = ? ORDER BY context, account_login`).bind(owner).all()
      return json({ connections: results }, 200, headers)
    }
    const match = path.match(/^\/api\/github\/connections\/([a-f0-9-]{36})(?:\/(repos|refresh))?$/i)
    if (match) {
      const connection = await connectionFor(env, owner, match[1])
      if (!connection) return errorResponse(404, 'connection_not_found', 'Connection not found', headers)
      if (!match[2] && request.method === 'DELETE') {
        await purgeConnection(env, connection.id)
        return json({ disconnected: true }, 200, headers)
      }
      if (match[2] === 'repos' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT repo_id, full_name, html_url, description, private, selected FROM github_repositories WHERE connection_id = ? ORDER BY full_name').bind(connection.id).all()
        return json({ repositories: results }, 200, headers)
      }
      if (match[2] === 'repos' && request.method === 'PUT') {
        const input = await body(request)
        if (!Array.isArray(input.repo_ids) || input.repo_ids.length > 500 || !input.repo_ids.every((id) => Number.isSafeInteger(id))) {
          return errorResponse(400, 'invalid_repository_selection', 'Choose valid repository IDs', headers)
        }
        const chosen = new Set(input.repo_ids as number[])
        const { results } = await env.DB.prepare('SELECT repo_id, selected FROM github_repositories WHERE connection_id = ?').bind(connection.id).all<{ repo_id: number; selected: number }>()
        if ([...chosen].some((id) => !results.some((row) => row.repo_id === id))) return errorResponse(400, 'repository_not_available', 'A selected repository is unavailable', headers)
        const selectedJson = JSON.stringify([...chosen])
        await env.DB.batch([
          env.DB.prepare(`UPDATE github_connections SET selection_revision = selection_revision + 1,
            last_full_sync_at = NULL, full_sync_started_at = NULL WHERE id = ?`).bind(connection.id),
          env.DB.prepare(`UPDATE github_repositories SET selected = CASE
            WHEN repo_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE connection_id = ?`)
            .bind(selectedJson, connection.id),
          ...['github_items', 'github_milestones', 'github_labels'].map((table) =>
            env.DB.prepare(`DELETE FROM ${table} WHERE connection_id = ? AND repo_id IN (
              SELECT repo_id FROM github_repositories WHERE connection_id = ? AND selected = 0)`)
              .bind(connection.id, connection.id)),
          env.DB.prepare('DELETE FROM github_sync_progress WHERE connection_id = ?').bind(connection.id),
          env.DB.prepare('DELETE FROM github_projects WHERE connection_id = ?').bind(connection.id),
        ])
        return json({ selected: [...chosen].length }, 200, headers)
      }
      if (match[2] === 'refresh' && request.method === 'POST') {
        await syncConnection(env, connection)
        const updated = await connectionFor(env, owner, connection.id)
        return json({ status: updated ? updated.full_sync_started_at ? 'syncing' : (updated as Connection & { status: string }).status : 'disconnected' }, 200, headers)
      }
    }
    if (path === '/api/github/dashboard' && request.method === 'GET') {
      const context = url.searchParams.get('context') || 'personal'
      if (!['personal', 'work', 'all'].includes(context)) return errorResponse(400, 'invalid_context', 'Invalid context', headers)
      const args = context === 'all' ? [owner] : [owner, context]
      const where = `c.owner_id = ?${context === 'all' ? '' : ' AND c.context = ?'}`
      const { results: items } = await env.DB.prepare(`SELECT i.kind, i.number, i.title, i.html_url, i.state, i.draft,
        i.author_login, i.assignees_json, i.requested_reviewers_json, i.labels_json, i.milestone_title,
        i.review_state, i.github_updated_at, i.sensitive, r.full_name AS repository, c.id AS connection_id,
        c.context, c.account_login, c.github_login FROM github_items i JOIN github_connections c ON c.id = i.connection_id
        JOIN github_repositories r ON r.connection_id = i.connection_id AND r.repo_id = i.repo_id
        WHERE ${where} AND r.selected = 1 AND i.state = 'open'
        ORDER BY i.github_updated_at DESC LIMIT 300`).bind(...args).all()
      const { results: milestones } = await env.DB.prepare(`SELECT m.title, m.state, m.due_on, m.open_issues,
        m.closed_issues, m.html_url, r.full_name AS repository, c.context, c.id AS connection_id
        FROM github_milestones m JOIN github_connections c ON c.id = m.connection_id
        JOIN github_repositories r ON r.connection_id = m.connection_id AND r.repo_id = m.repo_id
        WHERE ${where} AND r.selected = 1 AND m.state = 'open' ORDER BY m.due_on LIMIT 100`).bind(...args).all()
      const { results: projects } = await env.DB.prepare(`SELECT p.node_id, p.title, p.html_url, p.fields_json,
        p.items_json, p.sensitive, c.context, c.id AS connection_id FROM github_projects p
        JOIN github_connections c ON c.id = p.connection_id WHERE ${where} ORDER BY p.title LIMIT 100`).bind(...args).all()
      const { results: labels } = await env.DB.prepare(`SELECT l.name, l.color, r.full_name AS repository, c.context
        FROM github_labels l JOIN github_connections c ON c.id = l.connection_id
        JOIN github_repositories r ON r.connection_id = l.connection_id AND r.repo_id = l.repo_id
        WHERE ${where} AND r.selected = 1 ORDER BY l.name LIMIT 200`).bind(...args).all()
      return json({ items, milestones, projects, labels }, 200, headers)
    }
    return errorResponse(404, 'not_found', 'GitHub route not found', headers)
  } catch (error) {
    if (error instanceof GitHubError) return errorResponse(error.status, error.code, error.message, headers)
    return errorResponse(502, 'github_error', 'GitHub connector request failed', headers)
  }
}
