import { AiPrivacyError, aiService, type AiRequestOptions } from '../ai/aiService'

interface Env {
  AI: any
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}

type HistoryItem = { input: string; parsed: any; ts: string }

export class CommandParserDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/parse') return new Response('Not Found', { status: 404 })
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    let input: string
    let options: AiRequestOptions = {}
    try {
      const body = (await request.json()) as { input?: unknown } & AiRequestOptions
      input = typeof body.input === 'string' ? body.input.trim() : ''
      options = {
        provider: body.provider,
        allowOpenAISensitive: body.allowOpenAISensitive === true,
        includeWorkContext: body.includeWorkContext === true,
      }
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!input || input.length > 4000) {
      return Response.json({ error: 'Input must contain between 1 and 4000 characters' }, { status: 400 })
    }

    const history = ((await this.state.storage.get<HistoryItem[]>('history')) ?? []).slice(-4)

    const startedAt = Date.now()
    let model = 'unknown'
    let provider = 'workers-ai'
    let parsed
    try {
      if (history.length > 0) {
        const response = await aiService.parseWithHistoryWithMeta(input, history, this.env, options)
        parsed = response.data
        model = response.model
        provider = response.provider
      } else {
        const response = await aiService.parseTaskWithMeta(input, this.env, options)
        parsed = response.data
        model = response.model
        provider = response.provider
      }
    } catch (error) {
      if (error instanceof AiPrivacyError) {
        return Response.json({ error: 'OpenAI privacy consent is required for this request', code: error.code }, { status: 400 })
      }
      throw error
    }

    history.push({ input, parsed, ts: new Date().toISOString() })
    const boundedHistory = history.slice(-4)
    await this.state.storage.put('history', boundedHistory)

    return new Response(JSON.stringify({
      parsed,
      history: boundedHistory,
      telemetry: {
        model,
        provider,
        duration_ms: Date.now() - startedAt,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
