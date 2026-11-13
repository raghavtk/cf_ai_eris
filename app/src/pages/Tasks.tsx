import { useEffect, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { Alert, Button, MenuItem, TextField } from '@mui/material'
import './Tasks.css'
import { ApiRequestError, taskService } from '../services/taskService'
import { Link, useLocation } from 'react-router-dom'
import NaturalLanguageInput from '../components/NaturalLanguageInput'
import type { DemoWorkspace } from '../demo'
import type { ParsedTask, TaskCategory as Category, TaskPriority as Priority, TaskStatus as Status } from '../../../shared/contracts'

type FormStatus = Exclude<Status, 'cancelled'>

type TaskForm = {
  title: string
  description: string
  priority: Priority
  category: Category
  subcategory: string
  dueDate: string
  estimatedDuration: string
  status: FormStatus
  note: string
}

const initialState: TaskForm = {
  title: '',
  description: '',
  priority: 'medium',
  category: 'work',
  subcategory: 'Courses',
  dueDate: '',
  estimatedDuration: '',
  status: 'pending',
  note: '',
}

const subcategoryMap: Record<Category, string[]> = {
  work: ['Courses', 'Internship', 'Projects'],
  personal: ['Health', 'Social', 'Finance', 'Chores'],
  other: ['Other'],
}

const Tasks = ({ demoCreate }: { demoCreate?: DemoWorkspace['createTask'] }) => {
  const [form, setForm] = useState<TaskForm>(initialState)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error'; message: string } | null>(null)
  const location = useLocation()

  const handleChange =
    (field: keyof TaskForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleCategoryChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value as Category
    setForm((prev) => ({
      ...prev,
      category: value,
      subcategory: subcategoryMap[value][0],
    }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFeedback(null)
    try {
      await (demoCreate ?? taskService.create)({
        title: form.title,
        description: form.description,
        priority: form.priority,
        status: form.status,
        category: form.category,
        subcategory: form.subcategory,
        due_date: form.dueDate,
        estimated_duration: parseInt(form.estimatedDuration) || 0,
        note: form.note,
      })
      setForm(initialState)
      setFeedback({ severity: 'success', message: 'Task created. It is ready in your task list.' })
    } catch (error) {
      console.error('Failed to create task:', error)
      const detail = error instanceof ApiRequestError ? Object.values(error.details ?? {})[0] : undefined
      setFeedback({
        severity: 'error',
        message: detail || (error instanceof Error ? error.message : 'Failed to create task'),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => setForm(initialState)

  const handleParsedPreview = (parsed: ParsedTask) => {
    const normCategory = parsed.category?.toLowerCase() as Category | undefined
    const normPriority = parsed.priority?.toLowerCase() as Priority | undefined
    setForm((prev) => ({
      ...prev,
      title: parsed.title ?? prev.title,
      description: parsed.description ?? prev.description,
      priority: normPriority ?? prev.priority,
      category: normCategory ?? prev.category,
      subcategory: parsed.subcategory ?? prev.subcategory,
      dueDate: parsed.due_date ?? prev.dueDate,
      estimatedDuration:
        parsed.estimated_duration !== undefined
          ? String(parsed.estimated_duration)
          : prev.estimatedDuration,
      note: parsed.note ?? prev.note,
    }))
  }

  // If navigated from Home with parsed state, hydrate the form once
  useEffect(() => {
    const parsed = (location.state as { parsed?: ParsedTask } | null)?.parsed
    if (parsed) {
      handleParsedPreview(parsed)
    }
  }, [location.state])

  return (
    <section className='create-task'>
      <header className='create-task-header'>
        <h1>Create task</h1>
        <Link to='/view-tasks'>View tasks</Link>
      </header>

      <form onSubmit={handleSubmit}>
        {feedback && (
          <Alert severity={feedback.severity} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
            {feedback.message}
          </Alert>
        )}
        <fieldset className='create-task-layout' disabled={submitting} aria-label='Task fields'>
          <section className='create-task-content' aria-label='Task details'>
            <TextField label='Title' placeholder='What needs doing?' value={form.title} onChange={handleChange('title')} required fullWidth />
            <TextField label='Description' value={form.description} onChange={handleChange('description')} multiline minRows={4} fullWidth />
            <TextField label='Notes' value={form.note} onChange={handleChange('note')} multiline minRows={2}
              slotProps={{ htmlInput: { maxLength: 200 } }} helperText={form.note.length + '/200'} fullWidth />
          </section>

          <section className='create-task-properties' aria-labelledby='task-properties-heading'>
            <h2 id='task-properties-heading'>Properties</h2>
            <TextField select disabled={submitting} label='Status' value={form.status} onChange={handleChange('status')}>
              <MenuItem value='pending'>Pending</MenuItem>
              <MenuItem value='in_progress'>In progress</MenuItem>
              <MenuItem value='completed'>Completed</MenuItem>
            </TextField>
            <TextField select disabled={submitting} label='Priority' value={form.priority} onChange={handleChange('priority')}>
              <MenuItem value='high'>High</MenuItem>
              <MenuItem value='medium'>Medium</MenuItem>
              <MenuItem value='low'>Low</MenuItem>
            </TextField>
            <TextField label='Due date' type='date' value={form.dueDate} onChange={handleChange('dueDate')}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label='Estimate (minutes)' type='number' value={form.estimatedDuration}
              onChange={handleChange('estimatedDuration')} slotProps={{ htmlInput: { min: 0, max: 10080 } }} />
            <TextField select disabled={submitting} label='Category' value={form.category} onChange={handleCategoryChange}>
              <MenuItem value='work'>Work</MenuItem>
              <MenuItem value='personal'>Personal</MenuItem>
              <MenuItem value='other'>Other</MenuItem>
            </TextField>
            <TextField select disabled={submitting} label='Subcategory' value={form.subcategory} onChange={handleChange('subcategory')}>
              {Array.from(new Set([...(subcategoryMap[form.category] ?? []), form.subcategory])).map((sub) => (
                <MenuItem key={sub} value={sub}>{sub}</MenuItem>
              ))}
            </TextField>
          </section>
        </fieldset>
        <div className='create-task-actions'>
          <Button disabled={submitting} onClick={handleReset}>Reset</Button>
          <Button variant='contained' type='submit' disabled={submitting}>{submitting ? 'Creating…' : 'Create task'}</Button>
        </div>
      </form>

      <section className='create-task-capture' aria-labelledby='task-capture-heading'>
        <h2 id='task-capture-heading'>Capture with AI</h2>
        <NaturalLanguageInput onSavePreview={handleParsedPreview} demoCreate={demoCreate} />
      </section>
    </section>
  )
}

export default Tasks
