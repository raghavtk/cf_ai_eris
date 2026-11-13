import type { CreateTaskInput, ParsedTask, Task } from '../../shared/contracts'
import { localDate } from './localDate'
import type { TaskRow } from './components/TaskTable'

export const demoParsePath = '/api/demo/parse-task'

export const demoPrompt = 'Draft the portfolio case study in 90 minutes'

export function parseDemoTask(input: string): ParsedTask {
  const duration = input.match(/\b(\d{1,3})\s*(?:minutes?|mins?)\b/i)
  return {
    title: input.replace(/\s+in\s+\d{1,3}\s*(?:minutes?|mins?)\b/i, '').trim().slice(0, 120),
    priority: 'medium',
    category: 'work',
    subcategory: 'Projects',
    estimated_duration: duration ? Number(duration[1]) : 60,
  }
}

const seedTasks: Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'estimated_duration'>[] = [
  { id: 'sample-1', title: 'Review research notes', description: 'Choose three insights for the project brief', priority: 'high', estimated_duration: 30 },
  { id: 'sample-2', title: 'Prototype the dashboard', description: 'Sketch the first pass of the workspace', priority: 'medium', estimated_duration: 120 },
  { id: 'sample-3', title: 'Write the weekly recap', description: 'Capture progress and open questions', priority: 'low', estimated_duration: 15 },
]

export const createSampleTasks = () => seedTasks.map((task): Task => ({
  ...task,
  status: 'pending',
  category: 'work',
  subcategory: 'Projects',
  due_date: task.id === 'sample-1' ? localDate() : '',
  note: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}))

export async function parsePublicTask(input: string): Promise<{ parsed: ParsedTask; notice?: string }> {
  let notice = 'Live AI is unavailable. Showing a basic local parse.'
  try {
    const response = await fetch(demoParsePath, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ input }),
    })
    const data = await response.json() as { parsed?: ParsedTask; code?: string }
    if (response.ok && data.parsed?.title) return { parsed: data.parsed }
    if (data.code === 'demo_daily_limit') notice = 'The shared live AI budget is used up for today. Showing a basic local parse.'
    if (data.code === 'demo_rate_limit') notice = 'Live AI is temporarily rate limited. Showing a basic local parse.'
  } catch {
    // The local parser also works when the public endpoint is unreachable.
  }
  return { parsed: parseDemoTask(input), notice }
}

export type DemoWorkspace = {
  tasks: Task[]
  createTask: (input: CreateTaskInput) => Promise<Task>
}

export const mapTaskToRow = (task: Task): TaskRow => ({
  id: task.id,
  title: task.title,
  description: task.description,
  priority: task.priority,
  status: task.status,
  category: task.category,
  subcategory: task.subcategory,
  dueDate: task.due_date,
  estimatedDuration: task.estimated_duration,
  note: task.note,
})
