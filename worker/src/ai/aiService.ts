import { prompts, parseTaskWithHistory } from './prompts'

const MODEL_CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3-8b-instruct'
]

export type AiProvider = 'workers-ai' | 'openai'

export type AiRequestOptions = {
  provider?: AiProvider
  allowOpenAISensitive?: boolean
  includeWorkContext?: boolean
}

type AiResult = { data: Record<string, unknown>; model: string; provider: AiProvider; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }

const SENSITIVE_PATTERN = /\b(?:medical|health|diagnos(?:is|ed)|therapy|medication|ssn|social security|passport|bank account|credit card|password)\b/i
const WORK_PATTERN = /(?:github\.com|\b(?:confidential|internal|client|customer|work repo|company repository)\b|@[a-z0-9-]+\.(?:com|org|io)\b)/i

export class AiPrivacyError extends Error {
  constructor(public readonly code: 'openai_sensitive_consent_required' | 'openai_work_consent_required') {
    super(code)
  }
}

export const extractJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch (_) {
    const match = text.match(/\`\`\`\s*json\s*([\s\S]*?)\`\`\`/i) || text.match(/\`\`\`([\s\S]*?)\`\`\`/)
    if (match && match[1]) {
      try {
        return JSON.parse(match[1])
      } catch (_) {
        throw new Error('AI model returned invalid JSON')
      }
    }
    throw new Error('AI model returned invalid JSON')
  }
}

const normalize = (res: any) => {
  const normalized = typeof res === 'string' ? extractJson(res) : res
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('AI model returned a non-object response')
  }
  return normalized
}

const runWorkersAi = async (env: any, messages: any): Promise<AiResult> => {
  let lastError: unknown
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await env.AI.run(model as any, { messages })
      return { data: normalize(result?.response ?? result), model, provider: 'workers-ai' }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All AI model candidates failed')
}

const toOpenAiInput = (messages: Array<{ role: string; content: string }>) => messages.map(({ role, content }) => ({
  role,
  content: [{ type: 'input_text', text: content }],
}))

const runOpenAi = async (env: any, messages: any): Promise<AiResult> => {
  if (!env.OPENAI_API_KEY) throw new Error('OpenAI is not configured')
  const model = env.OPENAI_MODEL || 'gpt-5-mini'
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: toOpenAiInput(messages),
      store: false,
      text: { format: { type: 'json_object' } },
    }),
  })
  if (!response.ok) throw new Error(`OpenAI request failed with HTTP ${response.status}`)
  const result = await response.json() as any
  const output = result?.output_text ?? result?.output?.flatMap((item: any) => item?.content ?? []).find((item: any) => item?.type === 'output_text')?.text
  return {
    data: normalize(output),
    model,
    provider: 'openai',
    usage: {
      inputTokens: result?.usage?.input_tokens,
      outputTokens: result?.usage?.output_tokens,
      totalTokens: result?.usage?.total_tokens,
    },
  }
}

const enforceOpenAiPrivacy = (messages: Array<{ content: string }>, options: AiRequestOptions) => {
  const text = messages.map(({ content }) => content).join('\n')
  if (SENSITIVE_PATTERN.test(text) && !options.allowOpenAISensitive) throw new AiPrivacyError('openai_sensitive_consent_required')
  if (WORK_PATTERN.test(text) && !options.includeWorkContext) throw new AiPrivacyError('openai_work_consent_required')
}

const runAndNormalize = async (env: any, messages: any, options: AiRequestOptions = {}): Promise<AiResult> => {
  if (options.provider === 'openai') {
    enforceOpenAiPrivacy(messages, options)
    return runOpenAi(env, messages)
  }
  return runWorkersAi(env, messages)
}

export const aiService = {
  async parseTaskWithMeta(input: string, env: any, options?: AiRequestOptions) {
    const messages = prompts.parseTask(input)
    return runAndNormalize(env, messages, options)
  },
  async parseTask(input: string, env: any, options?: AiRequestOptions) {
    const { data } = await this.parseTaskWithMeta(input, env, options)
    return data
  },
  async parseWithHistoryWithMeta(input: string, history: any[], env: any, options?: AiRequestOptions) {
    const messages = parseTaskWithHistory(input, history)
    return runAndNormalize(env, messages, options)
  },
  async parseWithHistory(input: string, history: any[], env: any, options?: AiRequestOptions) {
    const { data } = await this.parseWithHistoryWithMeta(input, history, env, options)
    return data
  },
  async suggestPriorityWithMeta(task: any, env: any, options?: AiRequestOptions) {
    const messages = prompts.suggestPriority(task)
    return runAndNormalize(env, messages, options)
  },
  async suggestPriority(task: any, env: any, options?: AiRequestOptions) {
    const { data } = await this.suggestPriorityWithMeta(task, env, options)
    return data
  },
  async estimateDurationWithMeta(task: any, env: any, options?: AiRequestOptions) {
    const messages = prompts.estimateDuration(task)
    return runAndNormalize(env, messages, options)
  },
  async estimateDuration(task: any, env: any, options?: AiRequestOptions) {
    const { data } = await this.estimateDurationWithMeta(task, env, options)
    return data
  },
  async categorizeTaskWithMeta(task: any, env: any, options?: AiRequestOptions) {
    const messages = prompts.categorizeTask(task)
    return runAndNormalize(env, messages, options)
  },
  async categorizeTask(task: any, env: any, options?: AiRequestOptions) {
    const { data } = await this.categorizeTaskWithMeta(task, env, options)
    return data
  }
}
