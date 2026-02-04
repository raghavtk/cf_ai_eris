const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')

export type Task = {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  category: 'work' | 'personal' | 'other'
  subcategory: string
  due_date: string
  estimated_duration: number
  note: string
  created_at: string
  updated_at: string
}

export type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at'>

export const taskService = {
  async getAll(): Promise<Task[]> {
    const res = await fetch(`${API_BASE}/api/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
  },

  async getById(id: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`)
    if (!res.ok) throw new Error('Task not found')
    return res.json()
  },

  async create(input: CreateTaskInput): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error('Failed to create task')
    return res.json()
  },

  async update(id: string, input: Partial<Task>): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error('Failed to update task')
    return res.json()
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete task')
  },
}
