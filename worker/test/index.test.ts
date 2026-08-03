import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'

const createDatabase = () => {
  const run = vi.fn().mockResolvedValue({ success: true })
  const bind = vi.fn(() => ({ run }))
  const prepare = vi.fn(() => ({ bind }))
  return { prepare, bind }
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
