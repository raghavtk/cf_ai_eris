import { describe, expect, it } from 'vitest'
import { validateCreateTask, validateTaskTextInput, validateUpdateTask } from '../../shared/contracts'
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
})
