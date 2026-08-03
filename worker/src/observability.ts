type PreparedStatement = {
  bind: (...values: unknown[]) => { run: () => Promise<unknown> }
}

type TelemetryDatabase = {
  prepare: (query: string) => PreparedStatement
}

export type AiRequestTelemetry = {
  kind: string
  status: 'success' | 'error'
  durationMs: number
  errorCode?: string
  model?: string
}

const safeToken = (value: string | undefined, maxLength: number) => {
  if (!value) return null
  const normalized = value.replace(/[^a-zA-Z0-9@._:/, -]/g, '_').slice(0, maxLength)
  return normalized || null
}

/**
 * Writes operational metadata only. Task text and model output must never be
 * passed to or persisted by this function.
 */
export const logAiRequest = async (db: TelemetryDatabase, payload: AiRequestTelemetry) => {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const durationMs = Math.max(0, Math.round(payload.durationMs))
  const errorCode = safeToken(payload.errorCode, 64)
  const model = safeToken(payload.model, 200)

  try {
    await db.prepare(
      `INSERT INTO ai_requests (id, kind, status, created_at, duration_ms, error_message, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, payload.kind, payload.status, now, durationMs, errorCode, model)
      .run()
  } catch (error) {
    // Telemetry must never change the outcome of the user-facing request.
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    console.error(`Failed to record AI telemetry (${errorType})`)
  }

  return id
}

export const clampMetricsLimit = (rawValue: string | null, fallback = 20) => {
  const parsed = Number(rawValue ?? fallback)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 100)) : fallback
}
