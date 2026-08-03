import { describe, expect, it, vi } from 'vitest'
import { aiService, extractJson } from '../src/ai/aiService'

describe('aiService structured output', () => {
  it('accepts raw and fenced JSON objects', () => {
    expect(extractJson('{"priority":"high"}')).toEqual({ priority: 'high' })
    expect(extractJson('```json\n{"priority":"low"}\n```')).toEqual({ priority: 'low' })
  })

  it('uses the fallback model when the primary returns invalid JSON', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: 'not-json' })
      .mockResolvedValueOnce({ response: '{"priority":"high"}' })

    const result = await aiService.suggestPriorityWithMeta({ title: 'Urgent call' }, { AI: { run } })

    expect(run).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual({ priority: 'high' })
    expect(result.model).toBe('@cf/meta/llama-3-8b-instruct')
  })

  it('fails when every model returns an invalid structured response', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'not-json' })
    await expect(aiService.parseTaskWithMeta('Call mom', { AI: { run } })).rejects.toThrow(
      'AI model returned invalid JSON',
    )
    expect(run).toHaveBeenCalledTimes(2)
  })
})
