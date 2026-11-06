import type { Task } from '../../shared/contracts'

const priority = { high: 0, medium: 1, low: 2 }
const active = (task: Task) => task.status === 'pending' || task.status === 'in_progress'

export function recommendNext(tasks: Task[], minutes: number, today: string) {
  const seen = new Set<string>()
  return tasks
    .filter((task) => active(task) && task.estimated_duration > 0 && task.estimated_duration <= minutes)
    .sort((a, b) =>
      Number(!a.due_date) - Number(!b.due_date) ||
      a.due_date.localeCompare(b.due_date) ||
      priority[a.priority] - priority[b.priority] ||
      Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
      a.estimated_duration - b.estimated_duration ||
      a.id.localeCompare(b.id),
    )
    .filter(({ id }) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .slice(0, 3)
    .map((task) => ({
      task,
      deadline: !task.due_date ? null : task.due_date < today ? 'Overdue' :
        task.due_date === today ? 'Due today' : 'Due ' + task.due_date,
    }))
}
