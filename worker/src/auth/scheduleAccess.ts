import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface ScheduleAccessEnv {
  TEAM_DOMAIN?: string
  POLICY_AUD?: string
  ERIS_ALLOWED_EMAIL?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function getScheduleOwner(request: Request, env: ScheduleAccessEnv) {
  // Wrangler local requests have no Cloudflare request metadata. Production
  // requests always do, so a deployed Worker cannot opt into this identity.
  if (!request.cf) return 'local-dev'
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD || !env.ERIS_ALLOWED_EMAIL) return null

  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return null

  try {
    let keySet = keySets.get(env.TEAM_DOMAIN)
    if (!keySet) {
      const teamDomain = env.TEAM_DOMAIN.replace(/\/$/, '')
      keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
      keySets.set(env.TEAM_DOMAIN, keySet)
    }
    const { payload } = await jwtVerify(token, keySet, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    return email && email === env.ERIS_ALLOWED_EMAIL.toLowerCase() ? email : null
  } catch {
    return null
  }
}
