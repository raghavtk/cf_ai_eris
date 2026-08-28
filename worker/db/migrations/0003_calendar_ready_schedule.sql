CREATE TABLE schedule_entries_v2 (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  locked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'google')),
  external_calendar_id TEXT,
  external_event_id TEXT,
  external_etag TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'synced', 'pending', 'error')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CHECK (start_time < end_time)
);

INSERT INTO schedule_entries_v2 (id, task_id, scheduled_date, start_time, end_time, created_at)
SELECT id, task_id, scheduled_date, start_time, end_time, created_at FROM schedule_entries;

DROP TABLE schedule_entries;
ALTER TABLE schedule_entries_v2 RENAME TO schedule_entries;

CREATE INDEX idx_schedule_date ON schedule_entries(scheduled_date);
CREATE INDEX idx_schedule_date_times ON schedule_entries(scheduled_date, start_time, end_time);
CREATE UNIQUE INDEX idx_schedule_external_event
  ON schedule_entries(source, external_calendar_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
