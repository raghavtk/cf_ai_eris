import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubFetch, githubPages, refreshProjectToken, refreshUserToken, seal, unseal, type GitHubEnv } from '../src/github/githubApi'
import { handleGitHubRequest } from '../src/github/routes'
import { purgeConnection, scanFullList, syncProjects, type Connection } from '../src/github/sync'

const encryptionKey = Buffer.alloc(32, 7).toString('base64url')
const configuredEnv = (db: unknown = { prepare: vi.fn() }) => ({
  DB: db, GITHUB_APP_ID: '123', GITHUB_APP_SLUG: 'eris-read-only', GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'secret', GITHUB_PRIVATE_KEY: 'private-key', GITHUB_TOKEN_ENCRYPTION_KEY: encryptionKey,
  ERIS_ALLOWED_ORIGIN: 'https://eris.example',
}) as GitHubEnv
const connection = (): Connection => ({ id: 'connection-one', owner_id: 'owner', context: 'work', installation_id: 1,
  account_login: 'acme', account_type: 'Organization', encrypted_refresh_token: 'encrypted', selection_revision: 0,
  full_sync_started_at: '2026-09-24T00:00:00.000Z', last_synced_at: null, last_full_sync_at: null, next_retry_at: null })

afterEach(() => vi.restoreAllMocks())

describe('GitHub credentials and API boundaries', () => {
  it('encrypts user credentials with a fresh IV and rejects a wrong key', async () => {
    const env = configuredEnv()
    const first = await seal(env, 'private-refresh-token')
    const second = await seal(env, 'private-refresh-token')
    expect(first).not.toEqual(second)
    expect(first).not.toContain('private-refresh-token')
    await expect(unseal(env, first)).resolves.toBe('private-refresh-token')
    await expect(unseal({ ...env, GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64url') }, first)).rejects.toThrow()
  })

  it('follows GitHub pagination and reports rate-limit retry time', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: {
        link: '<https://api.github.com/repos/acme/demo/issues?page=2>; rel="next"',
      } }))
      .mockResolvedValueOnce(Response.json([{ id: 2 }]))
      .mockResolvedValueOnce(new Response('{}', { status: 403, headers: {
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      } }))
    await expect(githubPages<{ id: number }>('ephemeral', '/repos/acme/demo/issues')).resolves.toEqual([{ id: 1 }, { id: 2 }])
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer ephemeral' })
    await expect(githubFetch('ephemeral', '/rate_limit')).rejects.toMatchObject({ code: 'rate_limited', status: 403 })
  })

  it('does not treat a transient token endpoint failure as revoked authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'server_error' }), { status: 503 }))
    await expect(refreshUserToken(configuredEnv(), 'refresh')).rejects.toMatchObject({ code: 'github_oauth_failed', status: 502 })
  })

  it('recognizes an invalid refresh token as revoked authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'bad_refresh_token' }), { status: 400 }))
    await expect(refreshUserToken(configuredEnv(), 'refresh')).rejects.toMatchObject({ code: 'github_user_authorization_expired', status: 401 })
  })

  it('rotates the separate personal Projects refresh token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ access_token: 'project-access',
      refresh_token: 'next-project-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 }))
    await expect(refreshProjectToken({ ...configuredEnv(), GITHUB_PROJECT_OAUTH_CLIENT_ID: 'project-id',
      GITHUB_PROJECT_OAUTH_CLIENT_SECRET: 'project-secret' }, 'old-project-refresh'))
      .resolves.toMatchObject({ access_token: 'project-access', refresh_token: 'next-project-refresh' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ grant_type: 'refresh_token',
      refresh_token: 'old-project-refresh', client_id: 'project-id' })
  })
})

describe('GitHub sync safety', () => {
  it('resumes a full issue scan beyond 2,000 records instead of failing at page 20', async () => {
    let progress: { next_url: string; generation: string } | null = null
    const prepare = vi.fn((sql: string) => ({ bind: (...values: unknown[]) => ({
      first: async () => sql.includes('SELECT next_url, generation') ? progress : sql.includes('SELECT selection_revision') ? { selection_revision: 0 } : null,
      run: async () => {
        if (sql.includes('INSERT INTO github_sync_progress')) progress = { next_url: String(values[3]), generation: String(values[4]) }
        return { meta: { changes: 1 } }
      },
    }) }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const page = Number(String(input).match(/[?&]page=(\d+)/)?.[1] || 1)
      const data = Array.from({ length: 100 }, (_, index) => ({ id: page * 100 + index, number: page * 100 + index,
        title: 'Issue', html_url: 'https://github.com/acme/repo/issues/1', state: 'closed', updated_at: '2026-09-24T00:00:00Z' }))
      return Response.json(data, { headers: page < 21 ? {
        link: `<https://api.github.com/repos/acme/repo/issues?state=all&sort=created&direction=asc&per_page=100&page=${page + 1}>; rel="next"`,
      } : {} })
    })
    const repo = { id: 1, full_name: 'acme/repo', html_url: 'https://github.com/acme/repo', description: null, private: false }
    await expect(scanFullList(configuredEnv({ prepare }), connection(), repo, 'installation-token', 'issue', { pages: 12 })).resolves.toBe(false)
    expect(progress?.next_url).toContain('page=13')
    await expect(scanFullList(configuredEnv({ prepare }), connection(), repo, 'installation-token', 'issue', { pages: 12 })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(21)
    expect(progress?.next_url).toBe('')
    await expect(scanFullList(configuredEnv({ prepare }), connection(), repo, 'installation-token', 'issue', { pages: 12 })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(21)
    expect(prepare.mock.calls.some(([sql]) => sql.includes('INSERT INTO github_items') && sql.includes('c.selection_revision = ?'))).toBe(true)
  })

  it('fetches Project details only for items in selected repositories', async () => {
    const queries: { query: string; variables: Record<string, unknown> }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
      queries.push(body)
      if (body.query.includes('projectsV2(')) return Response.json({ data: { organization: { projectsV2: {
        nodes: [{ id: 'project-one', number: 1 }], pageInfo: { hasNextPage: false, endCursor: null },
      } } } })
      if (body.query.includes('items(first:100')) return Response.json({ data: { node: { items: {
        nodes: [{ id: 'selected-item', content: { repository: { fullDatabaseId: '1' } } },
          { id: 'unselected-item', content: { repository: { fullDatabaseId: '2' } } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } } })
      if (body.query.includes('fields(first:100')) return Response.json({ data: { node: {
        title: 'Selected work', url: 'https://github.com/orgs/acme/projects/1', fields: { nodes: [] },
      } } })
      return Response.json({ data: { nodes: [{ id: 'selected-item', content: { title: 'Allowed issue',
        url: 'https://github.com/acme/repo/issues/1' }, fieldValues: { nodes: [{ text: 'Allowed field' }] } }] } })
    })
    const binds: unknown[][] = []
    const prepare = vi.fn((sql: string) => ({ bind: (...values: unknown[]) => ({
      first: async () => sql.includes('SELECT selection_revision') ? { selection_revision: 0 } : null,
      all: async () => ({ results: [] }),
      run: async () => { if (sql.includes('INSERT INTO github_projects')) binds.push(values); return { meta: { changes: 1 } } },
    }) }))
    await syncProjects(configuredEnv({ prepare }), connection(), 'projects-token', new Set([1]))
    const discovery = queries.find((item) => item.query.includes('items(first:100'))!
    expect(discovery.query).not.toContain('fieldValues')
    expect(discovery.query).not.toContain('title')
    expect(queries.find((item) => item.query.includes('nodes(ids:$ids)'))?.variables.ids).toEqual(['selected-item'])
    expect(JSON.stringify(binds)).not.toContain('unselected-item')
  })
})

describe('GitHub connector routes', () => {
  const headers = { 'Access-Control-Allow-Origin': 'https://eris.example' }

  it('fails closed until the GitHub App is configured', async () => {
    const response = await handleGitHubRequest(new Request('https://worker.example/api/github/connections'), { DB: {} as D1Database }, 'owner@example.com', headers)
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'github_not_configured' })
  })

  it('rejects a forged OAuth callback state before exchanging any code', async () => {
    const first = vi.fn().mockResolvedValue(null)
    const bind = vi.fn().mockReturnValue({ first })
    const prepare = vi.fn().mockReturnValue({ bind })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const response = await handleGitHubRequest(new Request('https://worker.example/api/github/oauth/callback?state=forged&code=stolen'),
      configuredEnv({ prepare }), 'owner@example.com', headers)
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('https://eris.example/github?github_error=authorization_invalid')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('purges only the disconnected installation records and credential', async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    await purgeConnection(configuredEnv({ prepare }), 'connection-one')
    expect(prepare).toHaveBeenCalledTimes(7)
    expect(bind.mock.calls.every(([id]) => id === 'connection-one')).toBe(true)
    expect(prepare.mock.calls.at(-1)?.[0]).toContain('DELETE FROM github_connections WHERE id = ?')
  })

  it('changes repository selection and purges cache in one fenced batch', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const batch = vi.fn().mockResolvedValue([])
    const prepare = vi.fn((sql: string) => ({ bind: (...values: unknown[]) => ({
      sql, values,
      first: async () => sql.includes('SELECT * FROM github_connections') ? { ...connection(), id } : null,
      all: async () => ({ results: [{ repo_id: 1, selected: 1 }, { repo_id: 2, selected: 1 }] }),
    }) }))
    const response = await handleGitHubRequest(new Request(`https://worker.example/api/github/connections/${id}/repos`, {
      method: 'PUT', body: JSON.stringify({ repo_ids: [1] }),
    }), configuredEnv({ prepare, batch }), 'owner', headers)
    expect(response?.status).toBe(200)
    const statements = batch.mock.calls[0][0] as { sql: string }[]
    expect(statements[0].sql).toContain('selection_revision = selection_revision + 1')
    expect(statements[1].sql).toContain('UPDATE github_repositories SET selected')
    expect(statements.some((item) => item.sql.includes('DELETE FROM github_items'))).toBe(true)
    expect(statements.some((item) => item.sql.includes('DELETE FROM github_sync_progress'))).toBe(true)
  })
})
