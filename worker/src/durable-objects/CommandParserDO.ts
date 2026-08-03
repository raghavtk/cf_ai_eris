import { aiService } from '../ai/aiService'

interface Env {
  AI: any
}

type HistoryItem = { input: string; parsed: any; ts: string }

export class CommandParserDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/parse') return new Response('Not Found', { status: 404 })
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    let input: string
    try {
      const body = (await request.json()) as { input?: unknown }
      input = typeof body.input === 'string' ? body.input.trim() : ''
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!input || input.length > 4000) {
      return Response.json({ error: 'Input must contain between 1 and 4000 characters' }, { status: 400 })
    }

    const history = ((await this.state.storage.get<HistoryItem[]>('history')) ?? []).slice(-4)

    const startedAt = Date.now()
    let model = 'unknown'
    let parsed
    if (history.length > 0) {
      const response = await aiService.parseWithHistoryWithMeta(input, history, this.env)
      parsed = response.data
      model = response.model
    } else {
      const response = await aiService.parseTaskWithMeta(input, this.env)
      parsed = response.data
      model = response.model
    }

    history.push({ input, parsed, ts: new Date().toISOString() })
    const boundedHistory = history.slice(-4)
    await this.state.storage.put('history', boundedHistory)

    return new Response(JSON.stringify({
      parsed,
      history: boundedHistory,
      telemetry: {
        model,
        duration_ms: Date.now() - startedAt,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
