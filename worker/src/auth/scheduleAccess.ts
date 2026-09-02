import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface ScheduleAccessEnv {
  TEAM_DOMAIN?: string
  POLICY_AUD?: string
  ERIS_ALLOWED_EMAIL?: string
  ERIS_LOCAL_DEV?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function isLocalDevRequest(request: Request, env: ScheduleAccessEnv) {
  const hostname = new URL(request.url).hostname
  return env.ERIS_LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

export async function getScheduleOwner(request: Request, env: ScheduleAccessEnv) {
  if (isLocalDevRequest(request, env)) return 'local-dev'
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD || !env.ERIS_ALLOWED_EMAIL) return null

  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return null

  try {
    const teamDomain = env.TEAM_DOMAIN.replace(/\/$/, '')
    let keySet = keySets.get(teamDomain)
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
      keySets.set(teamDomain, keySet)
    }
    const { payload } = await jwtVerify(token, keySet, {
      issuer: teamDomain,
      audience: env.POLICY_AUD,
    })
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    return email && email === env.ERIS_ALLOWED_EMAIL.trim().toLowerCase() ? email : null
  } catch {
    return null
  }
}
