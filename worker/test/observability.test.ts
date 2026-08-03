import { describe, expect, it, vi } from 'vitest'
import { clampMetricsLimit, logAiRequest } from '../src/observability'

const createDatabase = (run = vi.fn().mockResolvedValue({ success: true })) => {
  const bind = vi.fn(() => ({ run }))
  const prepare = vi.fn(() => ({ bind }))
  return { db: { prepare }, prepare, bind, run }
}

describe('AI request observability', () => {
  it('stores operational metadata without an input or output field', async () => {
    const { db, prepare, bind } = createDatabase()
    await logAiRequest(db, {
      kind: 'parse-task',
      status: 'success',
      durationMs: 12.6,
      model: '@cf/meta/test-model',
    })

    const query = prepare.mock.calls[0][0]
    const boundValues = bind.mock.calls[0]
    expect(query).not.toContain('input_ref')
    expect(boundValues).toContain('parse-task')
    expect(boundValues).toContain(13)
    expect(boundValues).toContain('@cf/meta/test-model')
  })

  it('does not fail the user request when telemetry storage is unavailable', async () => {
    const { db } = createDatabase(vi.fn().mockRejectedValue(new Error('database unavailable')))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      logAiRequest(db, {
        kind: 'parse-task',
        status: 'error',
        durationMs: 10,
        errorCode: 'parse_task_failed',
      }),
    ).resolves.toEqual(expect.any(String))
    expect(consoleError).toHaveBeenCalledWith('Failed to record AI telemetry (Error)')
    consoleError.mockRestore()
  })

  it('clamps recent-request limits to the documented range', () => {
    expect(clampMetricsLimit(null)).toBe(20)
    expect(clampMetricsLimit('0')).toBe(1)
    expect(clampMetricsLimit('7.9')).toBe(7)
    expect(clampMetricsLimit('1000')).toBe(100)
    expect(clampMetricsLimit('invalid')).toBe(20)
  })
})
