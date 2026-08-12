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

  it('sends an opted-in OpenAI request server-side with store disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"priority":"high"}',
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await aiService.suggestPriorityWithMeta(
      { title: 'Urgent call' },
      { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test' },
      { provider: 'openai' },
    )

    expect(result).toMatchObject({ data: { priority: 'high' }, provider: 'openai', model: 'gpt-test' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
    }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ store: false, model: 'gpt-test' })
    vi.unstubAllGlobals()
  })

  it('requires explicit consent before sending sensitive or work-marked text to OpenAI', async () => {
    const env = { OPENAI_API_KEY: 'test-key' }
    await expect(aiService.parseTaskWithMeta('Medical appointment', env, { provider: 'openai' })).rejects.toMatchObject({
      code: 'openai_sensitive_consent_required',
    })
    await expect(aiService.parseTaskWithMeta('Review https://github.com/acme/private', env, { provider: 'openai' })).rejects.toMatchObject({
      code: 'openai_work_consent_required',
    })
  })
})
