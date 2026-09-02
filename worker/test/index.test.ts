import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'

const createDatabase = () => {
  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  const first = vi.fn().mockResolvedValue(null)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const bind = vi.fn(() => ({ run, first, all }))
  const prepare = vi.fn(() => ({ bind, first, all }))
  const batch = vi.fn().mockResolvedValue([])
  return { prepare, bind, run, first, all, batch }
}

const createEnv = (doResponse: Response) => {
  const db = createDatabase()
  const fetch = vi.fn().mockResolvedValue(doResponse)
  return {
    env: {
      DB: db,
      AI: {},
      ERIS_LOCAL_DEV: 'true',
      COMMAND_PARSER: {
        idFromName: vi.fn(() => 'session-id'),
        get: vi.fn(() => ({ fetch })),
      },
    },
    db,
    fetch,
  }
}

describe('parse-task endpoint telemetry', () => {
  it('returns 400 for invalid input without invoking the Durable Object', async () => {
    const { env, fetch, db } = createEnv(Response.json({ error: 'unused' }, { status: 500 }))
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({ input: '   ' }),
      }),
      env as any,
    )

    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('records a parser failure without storing the task text', async () => {
    const sensitiveInput = 'Private medical appointment tomorrow'
    const { env, db } = createEnv(Response.json({ error: 'model unavailable' }, { status: 502 }))
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({ input: sensitiveInput, sessionId: 'browser-session' }),
      }),
      env as any,
    )

    expect(response.status).toBe(502)
    expect(db.bind).toHaveBeenCalledTimes(1)
    expect(db.bind.mock.calls[0]).toContain('error')
    expect(db.bind.mock.calls[0]).toContain('parse_task_failed')
    expect(db.bind.mock.calls[0]).not.toContain(sensitiveInput)
    await expect(response.json()).resolves.toEqual({ error: 'parse-task failed' })
  })

  it('records model metadata for a successful parser response', async () => {
    const { env, db } = createEnv(
      Response.json({
        parsed: { title: 'Call mom' },
        history: [],
        telemetry: { provider: 'workers-ai', model: '@cf/meta/test-model', duration_ms: 42 },
      }),
    )
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({ input: 'Call mom' }),
      }),
      env as any,
    )

    expect(response.status).toBe(200)
    expect(db.bind.mock.calls[0]).toContain('success')
    expect(db.bind.mock.calls[0]).toContain('workers-ai:@cf/meta/test-model')
    expect(db.bind.mock.calls[0]).toContain(42)
    expect(db.bind.mock.calls[0]).not.toContain('Call mom')
  })
})

describe('task API validation', () => {
  it('returns a consistent error for malformed JSON', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/tasks', { method: 'POST', body: '{' }),
      env as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Request body must be valid JSON',
      code: 'invalid_json',
    })
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('rejects invalid task fields before writing to D1', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Ship release', priority: 'urgent' }),
      }),
      env as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid task payload',
      code: 'invalid_task',
      details: { priority: 'Use high, medium, or low' },
    })
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('normalizes and persists a valid task payload', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    db.first.mockResolvedValueOnce({
      id: 'task-id',
      title: 'Ship release',
      description: '',
      priority: 'medium',
      status: 'pending',
      category: 'work',
      subcategory: 'Courses',
      due_date: '',
      estimated_duration: 0,
      note: '',
    })

    const response = await worker.fetch(
      new Request('http://localhost:8787/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: '  Ship release  ' }),
      }),
      env as any,
    )

    expect(response.status).toBe(201)
    expect(db.run).toHaveBeenCalledOnce()
    expect(db.bind.mock.calls[0].slice(1, 10)).toEqual([
      'Ship release', '', 'medium', 'pending', 'work', 'Courses', '', 0, '',
    ])
    await expect(response.json()).resolves.toMatchObject({ title: 'Ship release' })
  })
})

describe('AI enrichment API validation', () => {
  it('returns a structured 400 before invoking AI or telemetry', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/ai/estimate-duration', {
        method: 'POST',
        body: JSON.stringify({ title: '   ' }),
      }),
      env as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid task payload',
      code: 'invalid_task',
      details: { title: 'Title is required' },
    })
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

describe('schedule API safety', () => {
  it('fails closed for production requests without Access configuration', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const request = new Request('https://worker.example/api/schedule?date=2026-08-27')
    Object.defineProperty(request, 'cf', { value: { colo: 'IAD' } })
    const response = await worker.fetch(request, env as any)
    expect(response.status).toBe(401)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('uses one atomic batch to replace a local daily plan', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    db.all
      .mockResolvedValueOnce({ results: [{ id: 'task-1', title: 'Focus', description: '', priority: 'high', status: 'pending', category: 'work', subcategory: '', due_date: '', estimated_duration: 60, note: '', created_at: '2026-08-01', updated_at: '2026-08-01' }] })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] })
    const response = await worker.fetch(new Request('http://localhost:8787/api/schedule/plan', {
      method: 'POST', body: JSON.stringify({ date: '2026-08-27', timezone: 'America/New_York', workday_start: '09:00', workday_end: '17:00' }),
    }), env as any)
    expect(response.status).toBe(200)
    expect(db.batch).toHaveBeenCalledOnce()
    expect(db.batch.mock.calls[0][0]).toHaveLength(2)
  })

  it('rejects an overlapping create when the atomic insert makes no change', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    db.run.mockResolvedValueOnce({ success: true, meta: { changes: 0 } })
    const response = await worker.fetch(new Request('http://localhost:8787/api/schedule', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
      body: JSON.stringify({ title: 'Conflict', task_id: null, scheduled_date: '2026-08-27', start_time: '09:00', end_time: '10:00', timezone: 'America/New_York', source: 'google', locked: true }),
    }), env as any)
    expect(response.status).toBe(409)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('rejects cross-origin requests outside the configured frontend', async () => {
    const { env } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(new Request('http://localhost:8787/api/schedule?date=2026-08-27', {
      headers: { Origin: 'https://attacker.example' },
    }), env as any)
    expect(response.status).toBe(403)
  })
})

describe('single-user access boundary', () => {
  it.each([
    ['tasks', '/api/tasks'],
    ['AI', '/api/ai/parse-task'],
    ['metrics', '/api/metrics/ai/summary'],
    ['schedule', '/api/schedule?date=2026-08-27'],
    ['session', '/api/auth/session'],
    ['root', '/'],
  ])('rejects unauthenticated production %s requests before using private bindings', async (_name, path) => {
    const { env, db, fetch } = createEnv(Response.json({ error: 'unused' }))
    const request = new Request(`https://worker.example${path}`)
    Object.defineProperty(request, 'cf', { value: { colo: 'IAD' } })
    const response = await worker.fetch(request, env as any)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication is required',
      code: 'authentication_required',
    })
    expect(db.prepare).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows credentialed preflight without authenticating and never uses wildcard CORS', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    Object.assign(env, { ERIS_ALLOWED_ORIGIN: 'https://eris.example' })
    const request = new Request('https://worker.example/api/tasks', {
      method: 'OPTIONS', headers: { Origin: 'https://eris.example' },
    })
    Object.defineProperty(request, 'cf', { value: { colo: 'IAD' } })
    const response = await worker.fetch(request, env as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://eris.example')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('returns the local owner from the session endpoint during local development', async () => {
    const { env } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(new Request('http://localhost:8787/api/auth/session'), env as any)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: true, owner: 'local-dev' })
  })

  it('does not infer local access merely because Cloudflare metadata is absent', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    delete (env as { ERIS_LOCAL_DEV?: string }).ERIS_LOCAL_DEV
    const response = await worker.fetch(new Request('http://localhost:8787/api/tasks'), env as any)

    expect(response.status).toBe(401)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('does not allow the local flag on a non-loopback hostname', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(new Request('https://worker.example/api/tasks'), env as any)

    expect(response.status).toBe(401)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('uses only the configured origin for the login return', async () => {
    const { env } = createEnv(Response.json({ error: 'unused' }))
    Object.assign(env, { ERIS_ALLOWED_ORIGIN: 'https://eris.example/app' })
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/auth/login?returnTo=https://attacker.example'), env as any,
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://eris.example/app?access=granted')
  })
})
