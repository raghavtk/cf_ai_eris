import type { AiResult, ParseTaskResponse, TaskTextInput } from '../../../shared/contracts'
import { apiFetch, readApiResponse } from './apiClient'

type PriorityInput = TaskTextInput & { due_date: string }

const readJson = <T>(response: Response, message: string) => readApiResponse<T>(response, message)

export const aiService = {
  parseTask: async (input: string, sessionId?: string) => {
    const res = await apiFetch('/api/ai/parse-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, sessionId }),
    })
    return readJson<ParseTaskResponse>(res, 'Failed to parse task')
  },

  suggestPriority: async (task: PriorityInput) => {
    const res = await apiFetch('/api/ai/suggest-priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to suggest priority')
  },

  estimateDuration: async (task: TaskTextInput) => {
    const res = await apiFetch('/api/ai/estimate-duration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to estimate duration')
  },

  categorizeTask: async (task: TaskTextInput) => {
    const res = await apiFetch('/api/ai/categorize-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    return readJson<AiResult>(res, 'Failed to categorize task')
  },
}
