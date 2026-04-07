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

    const { input } = (await request.json()) as { input: string }
    const history = ((await this.state.storage.get<HistoryItem[]>('history')) ?? []).slice(-4)
    
    let parsed
    if (history.length > 0) {
      parsed = await aiService.parseWithHistory(input, history, this.env)
    } else {
      parsed = await aiService.parseTask(input, this.env)
    }

    history.push({ input, parsed, ts: new Date().toISOString() })
    await this.state.storage.put('history', history.slice(-4))

    return new Response(JSON.stringify({ parsed, history }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
