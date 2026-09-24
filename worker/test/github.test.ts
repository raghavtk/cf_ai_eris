import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubFetch, githubPages, refreshUserToken, seal, unseal, type GitHubEnv } from '../src/github/githubApi'
import { handleGitHubRequest } from '../src/github/routes'
import { purgeConnection } from '../src/github/sync'

const encryptionKey = Buffer.alloc(32, 7).toString('base64url')
const configuredEnv = (db: unknown = { prepare: vi.fn() }) => ({
  DB: db, GITHUB_APP_ID: '123', GITHUB_APP_SLUG: 'eris-read-only', GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'secret', GITHUB_PRIVATE_KEY: 'private-key', GITHUB_TOKEN_ENCRYPTION_KEY: encryptionKey,
  ERIS_ALLOWED_ORIGIN: 'https://eris.example',
}) as GitHubEnv

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
    expect(prepare).toHaveBeenCalledTimes(6)
    expect(bind.mock.calls.every(([id]) => id === 'connection-one')).toBe(true)
    expect(prepare.mock.calls.at(-1)?.[0]).toContain('DELETE FROM github_connections WHERE id = ?')
  })
})
