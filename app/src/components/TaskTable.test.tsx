import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TaskTable from './TaskTable'
import type { TaskRow } from './TaskTable'
import type { Task } from '../services/taskService'
import * as taskServiceModule from '../services/taskService'
import { aiService } from '../services/aiService'

vi.mock('../services/aiService')

const mockTasks: TaskRow[] = [
  {
    id: '1',
    title: 'Test Task',
    description: 'Test Description',
    priority: 'high',
    status: 'pending',
    category: 'work',
    subcategory: 'Projects',
    dueDate: '',
    estimatedDuration: 30,
    note: 'note',
  },
]

const apiTask: Task = {
  id: '1',
  title: 'Test Task',
  description: 'Test Description',
  priority: 'high',
  status: 'pending',
  category: 'work',
  subcategory: 'Projects',
  due_date: '',
  estimated_duration: 30,
  note: 'note',
  created_at: '2026-08-11T00:00:00.000Z',
  updated_at: '2026-08-11T00:00:00.000Z',
}

describe('TaskTable selection + delete + AI actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects a row and deletes it', async () => {
    const mockDelete = vi.spyOn(taskServiceModule.taskService, 'delete').mockResolvedValue(undefined)
    render(<TaskTable tasks={mockTasks} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all tasks' }))
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('1'))
    await waitFor(() => expect(screen.queryByText('Test Task')).not.toBeInTheDocument())
  })

  it('runs estimate time on selected rows (calls AI)', async () => {
    vi.mocked(aiService.estimateDuration).mockResolvedValue({ estimated_minutes: 30 })
    vi.spyOn(taskServiceModule.taskService, 'update').mockResolvedValue(apiTask)
    vi.spyOn(taskServiceModule.taskService, 'getAll').mockResolvedValue([apiTask])

    render(<TaskTable tasks={mockTasks} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Estimate time' }))

    await waitFor(() => {
      expect(aiService.estimateDuration).toHaveBeenCalled()
    })
  })
})
