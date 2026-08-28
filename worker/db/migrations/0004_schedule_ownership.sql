ALTER TABLE schedule_entries ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local-dev';

DROP INDEX IF EXISTS idx_schedule_date;
DROP INDEX IF EXISTS idx_schedule_date_times;
DROP INDEX IF EXISTS idx_schedule_external_event;

CREATE INDEX idx_schedule_owner_date ON schedule_entries(owner_id, scheduled_date);
CREATE INDEX idx_schedule_owner_date_times ON schedule_entries(owner_id, scheduled_date, start_time, end_time);
CREATE UNIQUE INDEX idx_schedule_owner_external_event
  ON schedule_entries(owner_id, source, external_calendar_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
