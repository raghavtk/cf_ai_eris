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

  it('groups tasks by urgency when the visitor switches to Work queue', () => {
    render(<TaskTable readOnly tasks={[
      { ...mockTasks[0], title: 'Overdue task', dueDate: '2000-01-01' },
      { ...mockTasks[0], id: '2', title: 'Unscheduled task' },
      { ...mockTasks[0], id: '3', title: 'Finished task', status: 'completed', dueDate: '2000-01-01' },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Work queue' }))
    expect(screen.getByRole('rowgroup', { name: 'Overdue' })).toHaveTextContent('Overdue task')
    expect(screen.getByRole('rowgroup', { name: 'Later' })).toHaveTextContent('Unscheduled task')
    expect(screen.getByRole('rowgroup', { name: 'Closed' })).toHaveTextContent('Finished task')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.queryByRole('rowgroup', { name: 'Overdue' })).toBeNull()
  })

  it('shows descriptions and lets demo visitors add the Notes column', () => {
    render(<TaskTable tasks={mockTasks} readOnly />)
    expect(screen.getByText('Test Description')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Notes' })).toBeNull()
    fireEvent.click(screen.getByText('Columns'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }))
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'note' })).toBeInTheDocument()
  })

  it('selects a row and deletes it', async () => {
    const mockDelete = vi.spyOn(taskServiceModule.taskService, 'delete').mockResolvedValue(undefined)
    render(<TaskTable tasks={mockTasks} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Test Task' })).not.toBeInTheDocument())
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

  it('keeps the edited title after a failed save and updates the row after retry', async () => {
    const update = vi.spyOn(taskServiceModule.taskService, 'update')
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ ...apiTask, title: 'Renamed task' })
    render(<TaskTable tasks={mockTasks} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test Task' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Test Description')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Renamed task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Renamed task')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Renamed task' })).toBeInTheDocument()
    expect(update).toHaveBeenLastCalledWith('1', expect.objectContaining({ title: 'Renamed task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('button', { name: 'Renamed task' })).toBeInTheDocument()
  })
})
