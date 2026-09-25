import { importPKCS8, SignJWT } from 'jose'

export interface GitHubEnv {
  DB: D1Database
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_PRIVATE_KEY?: string
  GITHUB_TOKEN_ENCRYPTION_KEY?: string
  GITHUB_PROJECT_OAUTH_CLIENT_ID?: string
  GITHUB_PROJECT_OAUTH_CLIENT_SECRET?: string
  ERIS_ALLOWED_ORIGIN?: string
}

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAt?: string) {
    super(message)
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const apiVersion = '2026-03-10'

function required(value: string | undefined, name: string): string {
  if (!value) throw new GitHubError(503, 'github_not_configured', `${name} is not configured`)
  return value
}

export function configured(env: GitHubEnv): boolean {
  return !!(env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.GITHUB_PRIVATE_KEY && env.GITHUB_TOKEN_ENCRYPTION_KEY && env.ERIS_ALLOWED_ORIGIN)
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0))
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function encryptionKey(env: GitHubEnv): Promise<CryptoKey> {
  const raw = fromBase64url(required(env.GITHUB_TOKEN_ENCRYPTION_KEY, 'GITHUB_TOKEN_ENCRYPTION_KEY'))
  if (raw.length !== 32) throw new GitHubError(503, 'github_not_configured', 'GitHub encryption key must contain 32 bytes')
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(env: GitHubEnv, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encoder.encode(plaintext))
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`
}

export async function unseal(env: GitHubEnv, value: string): Promise<string> {
  const [iv, ciphertext] = value.split('.')
  if (!iv || !ciphertext) throw new GitHubError(500, 'github_credential_invalid', 'Stored GitHub credential is invalid')
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, await encryptionKey(env), fromBase64url(ciphertext)))
}

export async function appJwt(env: GitHubEnv): Promise<string> {
  const pem = required(env.GITHUB_PRIVATE_KEY, 'GITHUB_PRIVATE_KEY').replace(/\\n/g, '\n')
  const key = await importPKCS8(pem, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(required(env.GITHUB_APP_ID, 'GITHUB_APP_ID'))
    .setIssuedAt(now - 60).setExpirationTime(now + 8 * 60).sign(key)
}

export async function githubFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<{ data: T; response: Response }> {
  const url = path.startsWith('https://api.github.com/') ? path : `https://api.github.com${path}`
  if (!url.startsWith('https://api.github.com/')) throw new GitHubError(400, 'github_invalid_url', 'Invalid GitHub API URL')
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': apiVersion, 'User-Agent': 'Eris-GitHub-Connector', ...init.headers,
    },
  })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    const retryAfter = response.headers.get('retry-after')
    const retryAt = retryAfter && Number.isFinite(Number(retryAfter)) ? new Date(Date.now() + Number(retryAfter) * 1000).toISOString()
      : remaining === '0' && reset ? new Date(Number(reset) * 1000).toISOString() : undefined
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError(response.status, retryAt ? 'rate_limited' : 'approval_required', retryAt ? 'GitHub rate limit reached' : 'GitHub access was denied', retryAt)
    }
    if (response.status === 401) throw new GitHubError(response.status, 'access_revoked', 'GitHub access is unavailable')
    if (response.status === 404) throw new GitHubError(response.status, 'github_not_found', 'GitHub resource is unavailable')
    throw new GitHubError(502, 'github_upstream_error', `GitHub returned HTTP ${response.status}`)
  }
  return { data: response.status === 204 ? undefined as T : await response.json() as T, response }
}

export async function githubPages<T>(token: string, path: string, maxPages = 20): Promise<T[]> {
  let next: string | undefined = path
  const items: T[] = []
  for (let page = 0; next && page < maxPages; page++) {
    const { data, response } = await githubFetch<T[]>(token, next)
    if (!Array.isArray(data)) throw new GitHubError(502, 'github_invalid_response', 'GitHub returned an invalid list')
    items.push(...data)
    const link: string = response.headers.get('link') || ''
    const match: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/)
    next = match?.[1]
  }
  if (next) throw new GitHubError(502, 'github_page_limit', 'GitHub result exceeded the configured page limit')
  return items
}

export async function userInstallations<T extends { id: number }>(token: string): Promise<T[]> {
  const installations: T[] = []
  for (let page = 1; page <= 20; page++) {
    const { data } = await githubFetch<{ installations: T[] }>(token, `/user/installations?per_page=100&page=${page}`)
    if (!Array.isArray(data.installations)) throw new GitHubError(502, 'github_invalid_response', 'Invalid installation list')
    installations.push(...data.installations)
    if (data.installations.length < 100) return installations
  }
  throw new GitHubError(502, 'github_page_limit', 'Too many user installations')
}

export type OAuthTokens = { access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number }

export async function exchangeCode(env: GitHubEnv, code: string): Promise<OAuthTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: required(env.GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID'), client_secret: required(env.GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET'), code }),
  })
  const data = await response.json() as Partial<OAuthTokens> & { error?: string }
  if (!response.ok || data.error || !data.access_token || !data.refresh_token || !data.expires_in || !data.refresh_token_expires_in) {
    throw new GitHubError(502, 'github_oauth_failed', 'GitHub authorization failed')
  }
  return data as OAuthTokens
}

export async function refreshUserToken(env: GitHubEnv, refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: required(env.GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID'), client_secret: required(env.GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const data = await response.json() as Partial<OAuthTokens> & { error?: string }
  if (data.error === 'bad_refresh_token' || data.error === 'invalid_grant') {
    throw new GitHubError(401, 'github_user_authorization_expired', 'Reconnect GitHub to restore Projects access')
  }
  if (!response.ok || data.error || !data.access_token || !data.refresh_token) {
    throw new GitHubError(502, 'github_oauth_failed', 'GitHub token refresh failed')
  }
  return data as OAuthTokens
}

export async function exchangeProjectCode(env: GitHubEnv, code: string): Promise<OAuthTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: required(env.GITHUB_PROJECT_OAUTH_CLIENT_ID, 'GITHUB_PROJECT_OAUTH_CLIENT_ID'),
      client_secret: required(env.GITHUB_PROJECT_OAUTH_CLIENT_SECRET, 'GITHUB_PROJECT_OAUTH_CLIENT_SECRET'), code }),
  })
  const data = await response.json() as Partial<OAuthTokens> & { scope?: string; error?: string }
  if (!response.ok || data.error || !data.access_token || !data.refresh_token || !data.expires_in || !data.refresh_token_expires_in ||
      !data.scope?.split(',').includes('read:project')) {
    throw new GitHubError(403, 'github_projects_authorization_failed', 'GitHub Projects read permission was not granted')
  }
  return data as OAuthTokens
}

export async function refreshProjectToken(env: GitHubEnv, refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: required(env.GITHUB_PROJECT_OAUTH_CLIENT_ID, 'GITHUB_PROJECT_OAUTH_CLIENT_ID'),
      client_secret: required(env.GITHUB_PROJECT_OAUTH_CLIENT_SECRET, 'GITHUB_PROJECT_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const data = await response.json() as Partial<OAuthTokens> & { error?: string }
  if (data.error === 'bad_refresh_token' || data.error === 'invalid_grant') {
    throw new GitHubError(401, 'github_projects_authorization_expired', 'Reauthorize personal Projects')
  }
  if (!response.ok || data.error || !data.access_token || !data.refresh_token || !data.expires_in || !data.refresh_token_expires_in) {
    throw new GitHubError(502, 'github_projects_token_refresh_failed', 'GitHub Projects token refresh failed')
  }
  return data as OAuthTokens
}

export async function installationToken(env: GitHubEnv, installationId: number): Promise<string> {
  const jwt = await appJwt(env)
  let data: { token: string }
  try {
    ({ data } = await githubFetch<{ token: string }>(jwt, `/app/installations/${installationId}/access_tokens`, { method: 'POST' }))
  } catch (error) {
    if (error instanceof GitHubError && error.code === 'github_not_found') throw new GitHubError(404, 'access_revoked', 'GitHub installation was revoked')
    throw error
  }
  if (!data?.token) throw new GitHubError(502, 'github_token_failed', 'GitHub did not issue an installation token')
  return data.token
}

export async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const { data } = await githubFetch<{ data?: T; errors?: { message: string }[] }>(token, '/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }),
  })
  if (data.errors?.length || !data.data) throw new GitHubError(403, 'github_projects_unavailable', 'GitHub Projects are unavailable for this installation')
  return data.data
}
