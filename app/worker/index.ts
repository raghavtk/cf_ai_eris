import { validateCreateTask } from '../../shared/contracts'

const MODEL = '@cf/ibm-granite/granite-4.0-h-micro'
const MAX_OUTPUT_TOKENS = 256
const DAILY_BUDGET = 6_000
// Round up from the published cost of 131,000 input and 256 output tokens.
// Keep the reservation on failure too, since the provider may have billed it.
const RESERVATION = 210
const MAX_BODY_BYTES = 4_096
const MAX_PROMPT_LENGTH = 500

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

type DemoEnv = {
  AI: Ai
  DEMO_AI_BUDGET: DurableObjectNamespace
  DEMO_AI_RATE: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
}

async function readPrompt(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || !request.body) return
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return
      }
      text += decoder.decode(value, { stream: true })
    }
    const body = JSON.parse(text + decoder.decode()) as { input?: unknown } | null
    const input = typeof body?.input === 'string' ? body.input.trim() : ''
    return input && input.length <= MAX_PROMPT_LENGTH ? input : undefined
  } catch {
    return
  } finally {
    reader.releaseLock()
  }
}

export class DemoAiBudget {
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY, day TEXT NOT NULL, reserved INTEGER NOT NULL)')
  }

  fetch() {
    const day = new Date().toISOString().slice(0, 10)
    const admitted = this.ctx.storage.sql.exec<{ reserved: number }>(
      `INSERT INTO budget (id, day, reserved) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         day = excluded.day,
         reserved = CASE WHEN budget.day = excluded.day THEN budget.reserved + excluded.reserved ELSE excluded.reserved END
       WHERE budget.day < excluded.day OR (budget.day = excluded.day AND budget.reserved + excluded.reserved <= ?)
       RETURNING reserved`,
      day, RESERVATION, DAILY_BUDGET,
    ).toArray()
    return new Response(null, { status: admitted.length ? 204 : 429 })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/demo/parse-task') return new Response(null, { status: 404 })
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) return json({ error: 'Origin is not allowed' }, 403)

    const input = await readPrompt(request)
    if (!input) return json({ error: 'Enter a task prompt of up to 500 characters.' }, 400)

    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (!(await env.DEMO_AI_RATE.limit({ key: ip })).success) {
        return json({ code: 'demo_rate_limit' }, 429)
      }
      const budget = env.DEMO_AI_BUDGET.get(env.DEMO_AI_BUDGET.idFromName('public-ai'))
      const reservation = await budget.fetch('https://demo-budget.internal/reserve', { method: 'POST' })
      if (reservation.status === 429) return json({ code: 'demo_daily_limit' }, 429)
      if (reservation.status !== 204) return json({ code: 'demo_unavailable' }, 503)

      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: 'Convert the supplied text to one task. Return a JSON object only with title (required string), description (string), priority (high, medium, or low), category (work, personal, or other), and estimated_duration (integer minutes). Leave unspecified fields out.' },
          { role: 'user', content: input },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
      })
      const output = result.response
      const parsed = validateCreateTask(typeof output === 'string' ? JSON.parse(output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')) : output)
      if (!parsed.success) return json({ code: 'demo_unavailable' }, 502)
      const { title, description, priority, category, subcategory, estimated_duration } = parsed.data
      return json({ parsed: { title, description, priority, category, subcategory, estimated_duration } })
    } catch {
      return json({ code: 'demo_unavailable' }, 503)
    }
  },
} satisfies ExportedHandler<DemoEnv>
