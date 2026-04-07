import { prompts, parseTaskWithHistory } from './prompts'

const MODEL_CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3-8b-instruct'
]

const runWithFallback = async (env: any, messages: any) => {
  let lastErr: any
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await env.AI.run(model as any, { messages })
      return { result, model }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

const extractJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch (_) {
    const match = text.match(/\`\`\`\s*json\s*([\s\S]*?)\`\`\`/i) || text.match(/\`\`\`([\s\S]*?)\`\`\`/)
    if (match && match[1]) {
      try {
        return JSON.parse(match[1])
      } catch (_) {
        return { raw: text }
      }
    }
    return { raw: text }
  }
}

const normalize = (res: any) => {
  if (res == null) return null
  if (typeof res === 'string') return extractJson(res)
  if (typeof res === 'object') return res
  return { raw: res }
}

export const aiService = {
  async parseTask(input: string, env: any) {
    const messages = prompts.parseTask(input)
    const { result } = await runWithFallback(env, messages)
    return normalize(result?.response ?? result)
  },
  async parseWithHistory(input: string, history: any[], env: any) {
    const messages = parseTaskWithHistory(input, history)
    const { result } = await runWithFallback(env, messages)
    return normalize(result?.response ?? result)
  },
  async suggestPriority(task: any, env: any) {
    const messages = prompts.suggestPriority(task)
    const { result } = await runWithFallback(env, messages)
    return normalize(result?.response ?? result)
  },
  async estimateDuration(task: any, env: any) {
    const messages = prompts.estimateDuration(task)
    const { result } = await runWithFallback(env, messages)
    return normalize(result?.response ?? result)
  },
  async categorizeTask(task: any, env: any) {
    const messages = prompts.categorizeTask(task)
    const { result } = await runWithFallback(env, messages)
    return normalize(result?.response ?? result)
  }
}
