import { prompts, parseTaskWithHistory } from './prompts'

const MODEL_CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3-8b-instruct'
]

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

const runAndNormalize = async (env: any, messages: any) => {
  let lastError: unknown
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await env.AI.run(model as any, { messages })
      return { data: normalize(result?.response ?? result), model }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All AI model candidates failed')
}

export const aiService = {
  async parseTaskWithMeta(input: string, env: any) {
    const messages = prompts.parseTask(input)
    return runAndNormalize(env, messages)
  },
  async parseTask(input: string, env: any) {
    const { data } = await this.parseTaskWithMeta(input, env)
    return data
  },
  async parseWithHistoryWithMeta(input: string, history: any[], env: any) {
    const messages = parseTaskWithHistory(input, history)
    return runAndNormalize(env, messages)
  },
  async parseWithHistory(input: string, history: any[], env: any) {
    const { data } = await this.parseWithHistoryWithMeta(input, history, env)
    return data
  },
  async suggestPriorityWithMeta(task: any, env: any) {
    const messages = prompts.suggestPriority(task)
    return runAndNormalize(env, messages)
  },
  async suggestPriority(task: any, env: any) {
    const { data } = await this.suggestPriorityWithMeta(task, env)
    return data
  },
  async estimateDurationWithMeta(task: any, env: any) {
    const messages = prompts.estimateDuration(task)
    return runAndNormalize(env, messages)
  },
  async estimateDuration(task: any, env: any) {
    const { data } = await this.estimateDurationWithMeta(task, env)
    return data
  },
  async categorizeTaskWithMeta(task: any, env: any) {
    const messages = prompts.categorizeTask(task)
    return runAndNormalize(env, messages)
  },
  async categorizeTask(task: any, env: any) {
    const { data } = await this.categorizeTaskWithMeta(task, env)
    return data
  }
}
