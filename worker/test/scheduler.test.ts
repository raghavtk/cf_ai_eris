import { describe, expect, it } from 'vitest'
import { buildDailyPlan } from '../src/scheduler'
import type { Task } from '../../shared/contracts'

const task = (overrides: Partial<Task>): Task => ({
  id: 'task', title: 'Task', description: '', priority: 'medium', status: 'pending', category: 'work',
  subcategory: 'Projects', due_date: '', estimated_duration: 60, note: '', created_at: '2026-08-01', updated_at: '2026-08-01', ...overrides,
})

describe('daily scheduler', () => {
  it('prioritizes overdue and high-priority work', () => {
    const result = buildDailyPlan([
      task({ id: 'low', priority: 'low' }),
      task({ id: 'urgent', priority: 'high', due_date: '2026-08-26' }),
    ], [], '2026-08-27', '09:00', '11:00')
    expect(result.planned.map((block) => block.task.id)).toEqual(['urgent', 'low'])
  })

  it('rounds blocks to whole hours and avoids preserved calendar events', () => {
    const result = buildDailyPlan([task({ estimated_duration: 70 })], [{ start_time: '09:00', end_time: '10:00' }], '2026-08-27', '09:00', '13:00')
    expect(result.planned[0]).toMatchObject({ start_time: '10:00', end_time: '12:00' })
  })

  it('returns overflow tasks instead of overbooking the day', () => {
    const result = buildDailyPlan([task({ id: 'one' }), task({ id: 'two' })], [], '2026-08-27', '09:00', '10:00')
    expect(result.planned).toHaveLength(1)
    expect(result.unscheduled).toHaveLength(1)
  })
})
