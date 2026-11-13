import { describe, expect, it } from 'vitest'
import { recommendNext } from './recommendNext'
import type { Task } from '../../shared/contracts'

const today = '2026-11-06'
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, title: id, description: '', priority: 'medium', status: 'pending',
  category: 'work', subcategory: 'Projects', due_date: '', estimated_duration: 15,
  note: '', created_at: '', updated_at: '', ...overrides,
})

describe('next action recommendations', () => {
  it('ranks deadlines before priority, explains urgency, and shows at most three tasks', () => {
    const tasks = [
      task('priority', { priority: 'high' }),
      task('future', { due_date: '2026-11-09' }),
      task('today', { due_date: today, priority: 'high' }),
      task('late', { due_date: '2026-11-05', priority: 'low' }),
    ]
    expect(recommendNext(tasks, 15, today).map(({ task, deadline }) => [task.id, deadline])).toEqual([
      ['late', 'Overdue'], ['today', 'Due today'], ['future', 'Due 2026-11-09'],
    ])
  })

  it('filters tasks that cannot be acted on in the window and breaks ties consistently', () => {
    const tasks = [
      task('z'), task('a'), task('active', { status: 'in_progress' }), task('a'),
      task('unknown', { estimated_duration: 0 }), task('long', { estimated_duration: 16 }),
      task('done', { status: 'completed' }), task('cancelled', { status: 'cancelled' }),
    ]
    expect(recommendNext(tasks, 15, today).map(({ task }) => task.id)).toEqual(['active', 'a', 'z'])
    expect(recommendNext([...tasks].reverse(), 15, today).map(({ task }) => task.id)).toEqual(['active', 'a', 'z'])
    expect(recommendNext(tasks, 10, today)).toEqual([])
  })
})
