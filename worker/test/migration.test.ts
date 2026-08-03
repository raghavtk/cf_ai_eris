import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('AI observability migration', () => {
  it('adds model metadata, scrubs legacy prompt excerpts, and creates query indexes', async () => {
    const migration = await readFile(
      new URL('../db/migrations/0002_ai_requests_observability.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('ALTER TABLE ai_requests ADD COLUMN model TEXT')
    expect(migration).toContain('UPDATE ai_requests SET input_ref = NULL WHERE input_ref IS NOT NULL')
    expect(migration).toContain('idx_ai_requests_kind_created_at')
    expect(migration).toContain('idx_ai_requests_status')
  })
})
