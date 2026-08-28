import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('schedule ownership migration', () => {
  it('scopes schedule indexes and external identities by owner', async () => {
    const migration = await readFile(new URL('../db/migrations/0004_schedule_ownership.sql', import.meta.url), 'utf8')
    expect(migration).toContain("owner_id TEXT NOT NULL DEFAULT 'local-dev'")
    expect(migration).toContain('idx_schedule_owner_date_times')
    expect(migration).toContain('owner_id, source, external_calendar_id, external_event_id')
  })
})
