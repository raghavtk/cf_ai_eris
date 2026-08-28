import type { CreateScheduleEntryInput, DailyPlanInput, DailySchedule, ScheduleEntry } from '../../../shared/contracts'
import { ApiRequestError } from './taskService'

const PROD_API_BASE = 'https://productivity-assistant-worker.raghavtkesari.workers.dev'
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API_BASE : 'http://localhost:8787')
const read = async <T>(response: Response): Promise<T> => {
  if (response.ok) return response.json() as Promise<T>
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string }
  throw new ApiRequestError(body.error || 'Schedule request failed', response.status, body.code)
}
export const scheduleService = {
  getDay: (date: string) => fetch(`${API_BASE}/api/schedule?date=${encodeURIComponent(date)}`, { credentials: 'include' }).then((res) => read<ScheduleEntry[]>(res)),
  planDay: (input: DailyPlanInput) => fetch(`${API_BASE}/api/schedule/plan`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((res) => read<DailySchedule>(res)),
  create: (input: CreateScheduleEntryInput) => fetch(`${API_BASE}/api/schedule`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((res) => read<ScheduleEntry>(res)),
  delete: async (id: string) => { await read(await fetch(`${API_BASE}/api/schedule/${id}`, { method: 'DELETE', credentials: 'include' })) },
}
