const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')

export const aiService = {
  parseTask: async (input: string) => {
    const res = await fetch(`${API_BASE}/api/ai/parse-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    if (!res.ok) throw new Error('Failed to parse task')
    return res.json()
  },

  suggestPriority: async (task: any) => {
    const res = await fetch(`${API_BASE}/api/ai/suggest-priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) throw new Error('Failed to suggest priority')
    return res.json()
  },

  estimateDuration: async (task: any) => {
    const res = await fetch(`${API_BASE}/api/ai/estimate-duration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) throw new Error('Failed to estimate duration')
    return res.json()
  },

  categorizeTask: async (task: any) => {
    const res = await fetch(`${API_BASE}/api/ai/categorize-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) throw new Error('Failed to categorize task')
    return res.json()
  },
}
