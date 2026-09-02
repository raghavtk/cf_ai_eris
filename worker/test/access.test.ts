import { beforeEach, describe, expect, it, vi } from 'vitest'

const createRemoteJWKSet = vi.fn(() => 'test-key-set')
const jwtVerify = vi.fn()

vi.mock('jose', () => ({ createRemoteJWKSet, jwtVerify }))

const { getScheduleOwner } = await import('../src/auth/scheduleAccess')

const productionRequest = (token = 'access-token') => {
  const request = new Request('https://api.eris.example/api/tasks', {
    headers: { 'cf-access-jwt-assertion': token },
  })
  Object.defineProperty(request, 'cf', { value: { colo: 'IAD' } })
  return request
}

const env = {
  TEAM_DOMAIN: 'https://eris.cloudflareaccess.com/',
  POLICY_AUD: 'application-audience',
  ERIS_ALLOWED_EMAIL: 'Owner@Example.com ',
}

describe('Cloudflare Access identity verification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts only the configured email and returns its normalized identity', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { email: ' owner@example.com ' } })

    await expect(getScheduleOwner(productionRequest(), env)).resolves.toBe('owner@example.com')
    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL('https://eris.cloudflareaccess.com/cdn-cgi/access/certs'))
    expect(jwtVerify).toHaveBeenCalledWith('access-token', 'test-key-set', {
      issuer: 'https://eris.cloudflareaccess.com',
      audience: 'application-audience',
    })
  })

  it('rejects a valid token belonging to a different email', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { email: 'someone@example.com' } })
    await expect(getScheduleOwner(productionRequest(), env)).resolves.toBeNull()
  })

  it('rejects missing configuration, missing tokens, and verification failures', async () => {
    await expect(getScheduleOwner(productionRequest(), {})).resolves.toBeNull()
    await expect(getScheduleOwner(new Request('https://api.eris.example/api/tasks'), env)).resolves.toBeNull()
    jwtVerify.mockRejectedValueOnce(new Error('bad signature'))
    await expect(getScheduleOwner(productionRequest(), env)).resolves.toBeNull()
  })

  it('never enables local mode on a non-loopback hostname', async () => {
    await expect(getScheduleOwner(productionRequest(), { ...env, ERIS_LOCAL_DEV: 'true' })).resolves.toBeNull()
  })
})
