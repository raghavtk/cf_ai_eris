import type { Task } from '../../shared/contracts'

type BusyBlock = { task_id?: string | null; start_time: string; end_time: string }
export type PlannedBlock = { task: Task; start_time: string; end_time: string }

const minutes = (time: string) => {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const roundToHour = (value: number) => Math.ceil(value / 60) * 60

const score = (task: Task, date: string) => {
  const priority = task.priority === 'high' ? 300 : task.priority === 'medium' ? 200 : 100
  if (!task.due_date) return priority
  const days = Math.round((Date.parse(`${task.due_date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000)
  return priority + (days < 0 ? 1000 : Math.max(0, 200 - days * 20))
}

export function buildDailyPlan(tasks: Task[], busy: BusyBlock[], date: string, start: string, end: string) {
  const occupied = busy.map((block) => [minutes(block.start_time), minutes(block.end_time)] as const).sort((a, b) => a[0] - b[0])
  const preservedTaskIds = new Set(busy.map((block) => block.task_id).filter((id): id is string => Boolean(id)))
  const candidates = tasks
    .filter((task) => (task.status === 'pending' || task.status === 'in_progress') && !preservedTaskIds.has(task.id))
    .sort((a, b) => score(b, date) - score(a, date) || a.created_at.localeCompare(b.created_at))
  const planned: PlannedBlock[] = []
  const unscheduled: Task[] = []

  for (const task of candidates) {
    const duration = Math.max(60, roundToHour(task.estimated_duration || 60))
    let cursor = roundToHour(minutes(start))
    let placed = false
    while (cursor + duration <= minutes(end)) {
      const conflict = occupied.find(([from, to]) => cursor < to && cursor + duration > from)
      if (!conflict) {
        planned.push({ task, start_time: clock(cursor), end_time: clock(cursor + duration) })
        occupied.push([cursor, cursor + duration])
        occupied.sort((a, b) => a[0] - b[0])
        placed = true
        break
      }
      cursor = roundToHour(conflict[1])
    }
    if (!placed) unscheduled.push(task)
  }
  return { planned, unscheduled }
}
