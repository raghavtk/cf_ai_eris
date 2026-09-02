import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, AuthenticationRequiredError, readApiResponse } from './apiClient'

describe('readApiResponse', () => {
  it('treats a JSON 401 as expired authentication', async () => {
    const event = vi.fn()
    window.addEventListener('eris:authentication-required', event)
    await expect(readApiResponse(Response.json({ error: 'no' }, { status: 401 }), 'Failed'))
      .rejects.toBeInstanceOf(AuthenticationRequiredError)
    expect(event).toHaveBeenCalledOnce()
    window.removeEventListener('eris:authentication-required', event)
  })

  it('preserves a non-JSON server failure instead of logging the owner out', async () => {
    const event = vi.fn()
    window.addEventListener('eris:authentication-required', event)
    const request = readApiResponse(new Response('<h1>Bad gateway</h1>', {
      status: 502, headers: { 'Content-Type': 'text/html' },
    }), 'Service unavailable')
    await expect(request).rejects.toMatchObject<ApiRequestError>({
      status: 502, code: 'unexpected_response', message: 'Service unavailable',
    })
    expect(event).not.toHaveBeenCalled()
    window.removeEventListener('eris:authentication-required', event)
  })
})
