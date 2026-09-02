import type { CreateScheduleEntryInput, DailyPlanInput, DailySchedule, ScheduleEntry } from '../../../shared/contracts'
import { apiFetch, readApiResponse } from './apiClient'

const read = <T>(response: Response) => readApiResponse<T>(response, 'Schedule request failed')
export const scheduleService = {
  getDay: (date: string) => apiFetch(`/api/schedule?date=${encodeURIComponent(date)}`).then((res) => read<ScheduleEntry[]>(res)),
  planDay: (input: DailyPlanInput) => apiFetch('/api/schedule/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((res) => read<DailySchedule>(res)),
  create: (input: CreateScheduleEntryInput) => apiFetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((res) => read<ScheduleEntry>(res)),
  delete: async (id: string) => { await read<{ success: true }>(await apiFetch(`/api/schedule/${id}`, { method: 'DELETE' })) },
}
