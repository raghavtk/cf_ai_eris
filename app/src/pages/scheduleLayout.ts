import type { ScheduleEntry } from '../../../shared/contracts'

export const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export const visibleHourRange = (workdayStart: string, workdayEnd: string, entries: ScheduleEntry[]) => {
  const starts = [timeToMinutes(workdayStart), ...entries.map((entry) => timeToMinutes(entry.start_time))]
  const ends = [timeToMinutes(workdayEnd), ...entries.map((entry) => timeToMinutes(entry.end_time))]
  const startHour = Math.max(0, Math.floor(Math.min(...starts) / 60))
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(Math.max(...ends) / 60)))
  return { startHour, endHour }
}

export const blockPosition = (entry: ScheduleEntry, startHour: number, pixelsPerHour = 72) => {
  const start = timeToMinutes(entry.start_time)
  const end = timeToMinutes(entry.end_time)
  return {
    top: ((start - startHour * 60) / 60) * pixelsPerHour + 4,
    height: Math.max(32, ((end - start) / 60) * pixelsPerHour - 8),
  }
}
