import type { ApiError } from '../../../shared/contracts'

const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
export const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, string>

  constructor(message: string, status: number, code = 'request_failed', details?: Record<string, string>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class AuthenticationRequiredError extends ApiRequestError {
  constructor() {
    super('Owner authentication is required', 401, 'authentication_required')
    this.name = 'AuthenticationRequiredError'
    window.dispatchEvent(new Event('eris:authentication-required'))
  }
}

export const apiFetch = (path: string, init: RequestInit = {}) => fetch(`${API_BASE}${path}`, {
  ...init,
  credentials: 'include',
  headers: { ...init.headers },
})

export const readApiResponse = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const contentType = response.headers.get('content-type') || ''
  if (response.ok && contentType.includes('application/json')) return response.json() as Promise<T>

  if (response.status === 401 || response.type === 'opaqueredirect') {
    throw new AuthenticationRequiredError()
  }

  if (!contentType.includes('application/json')) {
    throw new ApiRequestError(fallbackMessage, response.status, 'unexpected_response')
  }

  let body: Partial<ApiError> = {}
  try { body = await response.json() as Partial<ApiError> } catch { /* stable fallback */ }
  throw new ApiRequestError(body.error || fallbackMessage, response.status, body.code, body.details)
}

export const authService = {
  loginUrl: `${API_BASE}/api/auth/login`,
  session: () => apiFetch('/api/auth/session', { redirect: 'manual' })
    .then((response) => readApiResponse<{ authenticated: true; owner: string }>(response, 'Unable to verify session')),
}
