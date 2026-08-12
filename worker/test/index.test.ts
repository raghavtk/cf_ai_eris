import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'

const createDatabase = () => {
  const run = vi.fn().mockResolvedValue({ success: true })
  const first = vi.fn().mockResolvedValue(null)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const bind = vi.fn(() => ({ run, first, all }))
  const prepare = vi.fn(() => ({ bind, first, all }))
  return { prepare, bind, run, first, all }
}

const createEnv = (doResponse: Response) => {
  const db = createDatabase()
  const fetch = vi.fn().mockResolvedValue(doResponse)
  return {
    env: {
      DB: db,
      AI: {},
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
      new Request('http://worker/api/ai/parse-task', {
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
      new Request('http://worker/api/ai/parse-task', {
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
        telemetry: { model: '@cf/meta/test-model', duration_ms: 42 },
      }),
    )
    const response = await worker.fetch(
      new Request('http://worker/api/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({ input: 'Call mom' }),
      }),
      env as any,
    )

    expect(response.status).toBe(200)
    expect(db.bind.mock.calls[0]).toContain('success')
    expect(db.bind.mock.calls[0]).toContain('@cf/meta/test-model')
    expect(db.bind.mock.calls[0]).toContain(42)
    expect(db.bind.mock.calls[0]).not.toContain('Call mom')
  })
})

describe('task API validation', () => {
  it('returns a consistent error for malformed JSON', async () => {
    const { env, db } = createEnv(Response.json({ error: 'unused' }))
    const response = await worker.fetch(
      new Request('http://worker/api/tasks', { method: 'POST', body: '{' }),
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
      new Request('http://worker/api/tasks', {
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
      new Request('http://worker/api/tasks', {
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
      new Request('http://worker/api/ai/estimate-duration', {
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
