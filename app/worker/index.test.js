// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { DemoAiBudget } from './index'

afterEach(() => vi.useRealTimers())

const request = (input, headers = {}, host = 'eris.example') => new Request('https://' + host + '/api/demo/parse-task', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ input }),
})

function fixture() {
  const database = new DatabaseSync(':memory:')
  const budget = new DemoAiBudget({ storage: { sql: {
    exec(query, ...args) {
      const statement = database.prepare(query)
      if (/^CREATE/.test(query)) {
        statement.run()
        return
      }
      return { toArray: () => statement.all(...args) }
    },
  } } })
  const run = vi.fn().mockResolvedValue({ response: '{"title":"Prepare review","priority":"high"}' })
  const limit = vi.fn().mockResolvedValue({ success: true })
  const env = {
    AI: { run },
    DEMO_AI_RATE: { limit },
    DEMO_AI_BUDGET: { idFromName: name => name, get: () => budget },
  }
  return { database, env, run, limit }
}

describe('public AI endpoint', () => {
  it('caps the shared budget under concurrent requests and reopens it at midnight UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-06T23:59:00Z'))
    const { database, env, run } = fixture()
    try {
      const responses = await Promise.all(Array.from({ length: 35 }, (_, i) =>
        worker.fetch(request('Prepare review', {}, i % 2 ? 'app.example' : 'app.account.workers.dev'), env)))
      const successes = responses.filter(response => response.ok)
      const denied = responses.filter(response => response.status === 429)
      expect(successes).toHaveLength(28)
      expect(denied).toHaveLength(7)
      expect(run).toHaveBeenCalledTimes(28)
      expect(successes[0].headers.get('Cache-Control')).toBe('no-store')
      expect(await successes[0].json()).toMatchObject({ parsed: { title: 'Prepare review', priority: 'high' } })
      expect(await denied[0].json()).toEqual({ code: 'demo_daily_limit' })

      vi.setSystemTime(new Date('2026-11-07T00:00:00Z'))
      expect((await worker.fetch(request('Prepare review'), env)).status).toBe(200)
      expect(run).toHaveBeenCalledTimes(29)
    } finally {
      database.close()
    }
  })

  it('rejects oversized and cross-origin requests before AI, and throttles individual visitors', async () => {
    const { database, env, run, limit } = fixture()
    try {
      expect((await worker.fetch(request('a'.repeat(5_000)), env)).status).toBe(400)
      expect((await worker.fetch(request('Prepare review', { Origin: 'https://other.example' }), env)).status).toBe(403)
      limit.mockResolvedValueOnce({ success: false })
      expect(await (await worker.fetch(request('Prepare review'), env)).json()).toEqual({ code: 'demo_rate_limit' })
      expect(run).not.toHaveBeenCalled()
      expect((await worker.fetch(request('Prepare review'), env)).status).toBe(200)
      expect(run).toHaveBeenCalledOnce()
    } finally {
      database.close()
    }
  })
})
