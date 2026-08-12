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
