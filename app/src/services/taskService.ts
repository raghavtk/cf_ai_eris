import type { ApiError, CreateTaskInput, Task, UpdateTaskInput } from '../../../shared/contracts'

const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')

export type { CreateTaskInput, Task, UpdateTaskInput }

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, string>

  constructor(
    message: string,
    status: number,
    code = 'request_failed',
    details?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const parseResponse = async <T>(res: Response, fallbackMessage: string): Promise<T> => {
  if (res.ok) return res.json() as Promise<T>

  let body: Partial<ApiError> = {}
  try {
    body = (await res.json()) as Partial<ApiError>
  } catch {
    // Keep the stable fallback when the upstream response is not JSON.
  }
  throw new ApiRequestError(body.error || fallbackMessage, res.status, body.code, body.details)
}

export const taskService = {
  async getAll(): Promise<Task[]> {
    const res = await fetch(`${API_BASE}/api/tasks`)
    return parseResponse<Task[]>(res, 'Failed to fetch tasks')
  },

  async getById(id: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`)
    return parseResponse<Task>(res, 'Task not found')
  },

  async create(input: CreateTaskInput): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return parseResponse<Task>(res, 'Failed to create task')
  },

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return parseResponse<Task>(res, 'Failed to update task')
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/tasks/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete task')
  },
}
