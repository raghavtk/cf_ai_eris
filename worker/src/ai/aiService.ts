import { prompts } from './prompts'

const MODEL_CANDIDATES = ['@cf/meta/llama-3-8b-instruct']

const runWithFallback = async (env: any, prompt: string) => {
  let lastErr: any
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await env.AI.run(model as any, { prompt })
      return { result, model }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

const extractJson = (text: string) => {
  // Try straight JSON first
  try {
    return JSON.parse(text)
  } catch (_) {
    // Try to pull the first fenced code block that looks like JSON
    const match = text.match(/```\s*json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/)
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
    const prompt = prompts.parseTask(input)
    const { result } = await runWithFallback(env, prompt)
    return normalize(result?.response ?? result)
  },
  async suggestPriority(task: any, env: any) {
    const prompt = prompts.suggestPriority(task)
    const { result } = await runWithFallback(env, prompt)
    return normalize(result?.response ?? result)
  },
  async estimateDuration(task: any, env: any) {
    const prompt = prompts.estimateDuration(task)
    const { result } = await runWithFallback(env, prompt)
    return normalize(result?.response ?? result)
  },
  async categorizeTask(task: any, env: any) {
    const prompt = prompts.categorizeTask(task)
    const { result } = await runWithFallback(env, prompt)
    return normalize(result?.response ?? result)
  },
}
