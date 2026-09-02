import type { CreateTaskInput, Task, UpdateTaskInput } from '../../../shared/contracts'
import { apiFetch, ApiRequestError, readApiResponse } from './apiClient'

export type { CreateTaskInput, Task, UpdateTaskInput }

export { ApiRequestError }

export const taskService = {
  async getAll(): Promise<Task[]> {
    const res = await apiFetch('/api/tasks')
    return readApiResponse<Task[]>(res, 'Failed to fetch tasks')
  },

  async getById(id: string): Promise<Task> {
    const res = await apiFetch(`/api/tasks/${id}`)
    return readApiResponse<Task>(res, 'Task not found')
  },

  async create(input: CreateTaskInput): Promise<Task> {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return readApiResponse<Task>(res, 'Failed to create task')
  },

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const res = await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return readApiResponse<Task>(res, 'Failed to update task')
  },

  async delete(id: string): Promise<void> {
    const res = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
    await readApiResponse<{ success: true }>(res, 'Failed to delete task')
  },
}
