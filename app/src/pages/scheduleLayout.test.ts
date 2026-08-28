import { describe, expect, it } from 'vitest'
import type { ScheduleEntry } from '../../../shared/contracts'
import { blockPosition, visibleHourRange } from './scheduleLayout'

const entry = (id: string, start_time: string, end_time: string): ScheduleEntry => ({
  id, owner_id: 'local-dev', task_id: null, title: id, scheduled_date: '2026-08-27', start_time, end_time,
  timezone: 'America/New_York', locked: 0, source: 'local', external_calendar_id: null,
  external_event_id: null, external_etag: null, sync_status: 'local', last_synced_at: null,
  created_at: '', updated_at: '',
})

describe('schedule timeline layout', () => {
  it('expands beyond work hours for early and late calendar events', () => {
    expect(visibleHourRange('09:00', '17:00', [entry('early', '06:30', '07:00'), entry('late', '21:00', '22:15')]))
      .toEqual({ startHour: 6, endHour: 23 })
  })

  it('positions multi-hour and same-hour entries independently by minute', () => {
    expect(blockPosition(entry('long', '09:00', '11:00'), 9)).toEqual({ top: 4, height: 136 })
    expect(blockPosition(entry('second', '09:30', '10:00'), 9)).toEqual({ top: 40, height: 32 })
  })
})
