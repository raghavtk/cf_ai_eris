import type { AiResult, ParseTaskResponse, TaskTextInput } from '../../../shared/contracts'

const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')

type PriorityInput = TaskTextInput & { due_date: string }

const readJson = async <T>(response: Response, message: string): Promise<T> => {
  if (!response.ok) throw new Error(message)
  return response.json() as Promise<T>
}

export const aiService = {
  parseTask: async (input: string, sessionId?: string) => {
    const res = await fetch(`${API_BASE}/api/ai/parse-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, sessionId }),
    })
    return readJson<ParseTaskResponse>(res, 'Failed to parse task')
  },

  suggestPriority: async (task: PriorityInput) => {
    const res = await fetch(`${API_BASE}/api/ai/suggest-priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to suggest priority')
  },

  estimateDuration: async (task: TaskTextInput) => {
    const res = await fetch(`${API_BASE}/api/ai/estimate-duration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to estimate duration')
  },

  categorizeTask: async (task: TaskTextInput) => {
    const res = await fetch(`${API_BASE}/api/ai/categorize-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to categorize task')
  },
}
