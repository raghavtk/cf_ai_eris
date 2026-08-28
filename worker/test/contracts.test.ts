import { describe, expect, it } from 'vitest'
import { validateCreateScheduleEntry, validateCreateTask, validateDailyPlan, validateTaskTextInput, validateUpdateTask } from '../../shared/contracts'
import type { CreateTaskInput } from '../../shared/contracts'

const existing: CreateTaskInput = {
  title: 'Existing task',
  description: '',
  priority: 'medium',
  status: 'pending',
  category: 'work',
  subcategory: 'Projects',
  due_date: '',
  estimated_duration: 30,
  note: '',
}

describe('shared API contracts', () => {
  it('applies safe defaults and trims create input', () => {
    expect(validateCreateTask({ title: '  Write tests  ' })).toEqual({
      success: true,
      data: {
        title: 'Write tests',
        description: '',
        priority: 'medium',
        status: 'pending',
        category: 'work',
        subcategory: 'Courses',
        due_date: '',
        estimated_duration: 0,
        note: '',
      },
    })
  })

  it('rejects invalid dates and out-of-range durations', () => {
    expect(validateCreateTask({ ...existing, due_date: 'tomorrow' })).toMatchObject({
      success: false,
      error: { code: 'invalid_task', details: { due_date: 'Use YYYY-MM-DD' } },
    })
    expect(validateCreateTask({ ...existing, estimated_duration: 10081 })).toMatchObject({
      success: false,
      error: { code: 'invalid_task' },
    })
  })

  it('validates a partial update against the existing record', () => {
    expect(validateUpdateTask({ priority: 'high' }, existing)).toMatchObject({
      success: true,
      data: { title: 'Existing task', priority: 'high' },
    })
  })

  it('bounds AI enrichment input before model invocation', () => {
    expect(validateTaskTextInput({ title: '  Plan sprint ', description: ' Scope work ' })).toEqual({
      success: true,
      data: { title: 'Plan sprint', description: 'Scope work' },
    })
  })

  it('validates calendar-ready schedule blocks and working hours', () => {
    expect(validateCreateScheduleEntry({ title: 'Focus', scheduled_date: '2026-08-27', start_time: '09:00', end_time: '10:00', timezone: 'America/New_York', source: 'google', locked: true })).toEqual({
      success: true,
      data: { task_id: null, title: 'Focus', scheduled_date: '2026-08-27', start_time: '09:00', end_time: '10:00', timezone: 'America/New_York' },
    })
    expect(validateCreateScheduleEntry({ title: 'Overlap', scheduled_date: '2026-08-27', start_time: '10:00', end_time: '09:00' })).toMatchObject({ success: false })
    expect(validateDailyPlan({ date: '2026-08-27', timezone: 'America/New_York', workday_start: '09:00', workday_end: '17:00' })).toMatchObject({ success: true })
  })
})
