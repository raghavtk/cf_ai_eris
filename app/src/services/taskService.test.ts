import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiRequestError, taskService } from './taskService'
import type { CreateTaskInput, Task } from './taskService'

global.fetch = vi.fn()
const fetchMock = vi.mocked(global.fetch)

const input: CreateTaskInput = {
  title: 'New Task',
  description: '',
  priority: 'medium',
  status: 'pending',
  category: 'work',
  subcategory: 'Projects',
  due_date: '',
  estimated_duration: 0,
  note: '',
}

const task: Task = {
  id: '2',
  ...input,
  created_at: '2026-08-11T00:00:00.000Z',
  updated_at: '2026-08-11T00:00:00.000Z',
}

describe('taskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch all tasks', async () => {
    const mockTasks = [{ ...task, id: '1', title: 'Test', priority: 'high' as const }]
    fetchMock.mockResolvedValueOnce(Response.json(mockTasks))

    const result = await taskService.getAll()
    expect(result).toEqual(mockTasks)
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8787/api/tasks')
  })

  it('should create a task', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(task))

    const result = await taskService.create(input)
    expect(result).toEqual(task)
  })

  it('should update a task', async () => {
    const updated = { title: 'Updated' }
    const mockTask = { ...task, id: '1', ...updated }
    fetchMock.mockResolvedValueOnce(Response.json(mockTask))

    const result = await taskService.update('1', updated)
    expect(result.title).toBe('Updated')
  })

  it('should delete a task', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await taskService.delete('123')
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8787/api/tasks/123', { method: 'DELETE' })
  })

  it('surfaces structured API validation errors', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        error: 'Invalid task payload',
        code: 'invalid_task',
        details: { title: 'Title is required' },
      }, { status: 400 }),
    )

    const request = taskService.create({ ...input, title: '' })
    await expect(request).rejects.toMatchObject<ApiRequestError>({
      message: 'Invalid task payload',
      status: 400,
      code: 'invalid_task',
      details: { title: 'Title is required' },
    })
  })
})
