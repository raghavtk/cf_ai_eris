import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiService } from '../src/ai/aiService'
import { CommandParserDO } from '../src/durable-objects/CommandParserDO'

const createState = (initialHistory: unknown[] = []) => {
  let history = initialHistory
  return {
    storage: {
      get: vi.fn(async () => history),
      put: vi.fn(async (_key: string, value: unknown[]) => {
        history = value
      }),
    },
  }
}

describe('CommandParserDO', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects invalid input before calling a model or updating history', async () => {
    const state = createState()
    const modelCall = vi.spyOn(aiService, 'parseTaskWithMeta')
    const object = new CommandParserDO(state as any, {} as any)

    const response = await object.fetch(
      new Request('http://do/parse', { method: 'POST', body: JSON.stringify({ input: '   ' }) }),
    )

    expect(response.status).toBe(400)
    expect(modelCall).not.toHaveBeenCalled()
    expect(state.storage.put).not.toHaveBeenCalled()
  })

  it('does not overwrite prior history when every model fails', async () => {
    const previous = [{ input: 'Call mom', parsed: { title: 'Call mom' }, ts: '2026-01-01T00:00:00Z' }]
    const state = createState(previous)
    vi.spyOn(aiService, 'parseWithHistoryWithMeta').mockRejectedValue(new Error('model unavailable'))
    const object = new CommandParserDO(state as any, {} as any)

    await expect(
      object.fetch(new Request('http://do/parse', { method: 'POST', body: JSON.stringify({ input: 'tomorrow' }) })),
    ).rejects.toThrow('model unavailable')
    expect(state.storage.put).not.toHaveBeenCalled()
  })

  it('returns model telemetry and keeps only four successful history items', async () => {
    const prior = Array.from({ length: 4 }, (_, index) => ({
      input: `task-${index}`,
      parsed: { title: `Task ${index}` },
      ts: `2026-01-0${index + 1}T00:00:00Z`,
    }))
    const state = createState(prior)
    vi.spyOn(aiService, 'parseWithHistoryWithMeta').mockResolvedValue({
      data: { title: 'Updated task' },
      model: '@cf/meta/test-model',
    })
    const object = new CommandParserDO(state as any, {} as any)

    const response = await object.fetch(
      new Request('http://do/parse', { method: 'POST', body: JSON.stringify({ input: 'update it' }) }),
    )
    const body = (await response.json()) as any

    expect(response.status).toBe(200)
    expect(body.history).toHaveLength(4)
    expect(body.history.at(-1).parsed).toEqual({ title: 'Updated task' })
    expect(body.telemetry.model).toBe('@cf/meta/test-model')
    expect(state.storage.put).toHaveBeenCalledTimes(1)
  })
})
