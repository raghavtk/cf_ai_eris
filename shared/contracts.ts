export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const
export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
export const TASK_CATEGORIES = ['work', 'personal', 'other'] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskCategory = (typeof TASK_CATEGORIES)[number]

export type Task = {
  id: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  category: TaskCategory
  subcategory: string
  due_date: string
  estimated_duration: number
  note: string
  created_at: string
  updated_at: string
}

export type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at'>
export type UpdateTaskInput = Partial<CreateTaskInput>

export type CalendarProvider = 'local' | 'google'

export type ScheduleEntry = {
  id: string
  owner_id: string
  task_id: string | null
  title: string
  scheduled_date: string
  start_time: string
  end_time: string
  timezone: string
  locked: number
  source: CalendarProvider
  external_calendar_id: string | null
  external_event_id: string | null
  external_etag: string | null
  sync_status: 'local' | 'synced' | 'pending' | 'error'
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type CreateScheduleEntryInput = Pick<ScheduleEntry, 'task_id' | 'title' | 'scheduled_date' | 'start_time' | 'end_time' | 'timezone'>

export type DailyPlanInput = {
  date: string
  timezone: string
  workday_start: string
  workday_end: string
}

export type DailySchedule = {
  date: string
  timezone: string
  entries: ScheduleEntry[]
  unscheduled: Task[]
}

export type ParsedTask = {
  title?: string
  description?: string
  priority?: string
  due_date?: string
  category?: string
  subcategory?: string
  estimated_duration?: number
  note?: string | null
}

export type ParseHistoryItem = {
  input: string
  parsed: ParsedTask
  ts?: string
}

export type ParseTaskResponse = {
  parsed: ParsedTask
  history?: ParseHistoryItem[]
}

export type AiResult = Record<string, unknown>

export type TaskTextInput = {
  title: string
  description: string
  due_date?: string
}

export type ApiError = {
  error: string
  code: string
  details?: Record<string, string>
}

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T)

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)

const fieldError = (field: string, message: string): ValidationResult<never> => ({
  success: false,
  error: {
    error: 'Invalid task payload',
    code: 'invalid_task',
    details: { [field]: message },
  },
})

const validateDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)
const validateTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

export function validateCreateTask(value: unknown): ValidationResult<CreateTaskInput> {
  if (!isRecord(value)) return fieldError('body', 'Expected a JSON object')

  const title = text(value.title)
  if (!title) return fieldError('title', 'Title is required')
  if (title.length > 200) return fieldError('title', 'Title must be 200 characters or fewer')

  const description = text(value.description)
  if (description.length > 2000) return fieldError('description', 'Description must be 2000 characters or fewer')

  const priority = value.priority ?? 'medium'
  if (!isOneOf(priority, TASK_PRIORITIES)) return fieldError('priority', 'Use high, medium, or low')

  const status = value.status ?? 'pending'
  if (!isOneOf(status, TASK_STATUSES)) {
    return fieldError('status', 'Use pending, in_progress, completed, or cancelled')
  }

  const category = value.category ?? 'work'
  if (!isOneOf(category, TASK_CATEGORIES)) return fieldError('category', 'Use work, personal, or other')

  const subcategory = text(value.subcategory, category === 'work' ? 'Courses' : 'Other')
  if (subcategory.length > 100) return fieldError('subcategory', 'Subcategory must be 100 characters or fewer')

  const dueDate = text(value.due_date)
  if (!validateDate(dueDate)) return fieldError('due_date', 'Use YYYY-MM-DD')

  const duration = value.estimated_duration ?? 0
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 10080) {
    return fieldError('estimated_duration', 'Use a whole number from 0 to 10080')
  }

  const note = text(value.note)
  if (note.length > 200) return fieldError('note', 'Note must be 200 characters or fewer')

  return {
    success: true,
    data: {
      title,
      description,
      priority,
      status,
      category,
      subcategory,
      due_date: dueDate,
      estimated_duration: duration,
      note,
    },
  }
}

export function validateUpdateTask(value: unknown, existing: CreateTaskInput): ValidationResult<CreateTaskInput> {
  if (!isRecord(value)) return fieldError('body', 'Expected a JSON object')
  return validateCreateTask({ ...existing, ...value })
}

export function validateTaskTextInput(value: unknown): ValidationResult<TaskTextInput> {
  if (!isRecord(value)) return fieldError('body', 'Expected a JSON object')

  const title = text(value.title)
  if (!title) return fieldError('title', 'Title is required')
  if (title.length > 200) return fieldError('title', 'Title must be 200 characters or fewer')

  const description = text(value.description)
  if (description.length > 2000) return fieldError('description', 'Description must be 2000 characters or fewer')

  const dueDate = text(value.due_date)
  if (!validateDate(dueDate)) return fieldError('due_date', 'Use YYYY-MM-DD')

  return {
    success: true,
    data: { title, description, ...(dueDate ? { due_date: dueDate } : {}) },
  }
}

export function validateCreateScheduleEntry(value: unknown): ValidationResult<CreateScheduleEntryInput> {
  if (!isRecord(value)) return fieldError('body', 'Expected a JSON object')
  const taskId = value.task_id === null || value.task_id === undefined ? null : text(value.task_id)
  const title = text(value.title)
  const date = text(value.scheduled_date)
  const start = text(value.start_time)
  const end = text(value.end_time)
  const timezone = text(value.timezone, 'UTC')
  if (!title) return fieldError('title', 'Title is required')
  if (!validateDate(date) || !date) return fieldError('scheduled_date', 'Use YYYY-MM-DD')
  if (!validateTime(start) || !validateTime(end)) return fieldError('time', 'Use HH:MM')
  if (start >= end) return fieldError('end_time', 'End time must be after start time')
  if (timezone.length > 100) return fieldError('timezone', 'Timezone must be 100 characters or fewer')
  return { success: true, data: { task_id: taskId, title, scheduled_date: date, start_time: start, end_time: end, timezone } }
}

export function validateDailyPlan(value: unknown): ValidationResult<DailyPlanInput> {
  if (!isRecord(value)) return fieldError('body', 'Expected a JSON object')
  const date = text(value.date)
  const timezone = text(value.timezone, 'UTC')
  const start = text(value.workday_start, '09:00')
  const end = text(value.workday_end, '17:00')
  if (!validateDate(date) || !date) return fieldError('date', 'Use YYYY-MM-DD')
  if (!validateTime(start) || !validateTime(end) || start >= end) return fieldError('workday', 'Use a valid start and end in HH:MM')
  if (timezone.length > 100) return fieldError('timezone', 'Timezone must be 100 characters or fewer')
  return { success: true, data: { date, timezone, workday_start: start, workday_end: end } }
}
