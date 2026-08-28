import { validateCreateScheduleEntry, validateDailyPlan } from '../../../shared/contracts'
import type { ApiError, ScheduleEntry, Task } from '../../../shared/contracts'
import { getScheduleOwner, type ScheduleAccessEnv } from '../auth/scheduleAccess'
import { buildDailyPlan } from '../scheduler'

export interface ScheduleEnv extends ScheduleAccessEnv {
  DB: D1Database
  ERIS_ALLOWED_ORIGIN?: string
}

const baseCorsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
}

const responseJson = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const responseError = (status: number, code: string, error: string, headers: Record<string, string>, details?: Record<string, string>) =>
  responseJson({ error, code, ...(details ? { details } : {}) } satisfies ApiError, status, headers)

const readBody = async (request: Request) => {
  try { return { ok: true as const, data: await request.json() } }
  catch { return { ok: false as const } }
}

const selectDay = (db: D1Database, owner: string, date: string) => db.prepare(
  `SELECT s.*, COALESCE(NULLIF(s.title, ''), t.title, 'Busy') AS title
   FROM schedule_entries s LEFT JOIN tasks t ON t.id = s.task_id
   WHERE s.owner_id = ? AND s.scheduled_date = ? ORDER BY s.start_time`,
).bind(owner, date).all()

export async function handleScheduleRequest(request: Request, env: ScheduleEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/schedule')) return null

  const origin = request.headers.get('Origin')
  const allowedOrigins = new Set(['http://localhost:5173', ...(env.ERIS_ALLOWED_ORIGIN ? [env.ERIS_ALLOWED_ORIGIN] : [])])
  if (origin && !allowedOrigins.has(origin)) {
    return responseError(403, 'origin_not_allowed', 'Origin is not allowed', baseCorsHeaders)
  }
  const corsHeaders = {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': origin || env.ERIS_ALLOWED_ORIGIN || 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const owner = await getScheduleOwner(request, env)
  if (!owner) return responseError(401, 'schedule_unauthorized', 'Schedule access requires authentication', corsHeaders)

  if (url.pathname === '/api/schedule' && request.method === 'GET') {
    const date = url.searchParams.get('date') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return responseError(400, 'invalid_schedule_date', 'Use date=YYYY-MM-DD', corsHeaders)
    const { results } = await selectDay(env.DB, owner, date)
    return responseJson(results, 200, corsHeaders)
  }

  if (url.pathname === '/api/schedule' && request.method === 'POST') {
    const payload = await readBody(request)
    if (!payload.ok) return responseError(400, 'invalid_json', 'Request body must be valid JSON', corsHeaders)
    const validation = validateCreateScheduleEntry(payload.data)
    if (!validation.success) return responseJson(validation.error, 400, corsHeaders)

    const body = validation.data
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const result = await env.DB.prepare(
      `INSERT INTO schedule_entries
       (id,owner_id,task_id,title,scheduled_date,start_time,end_time,timezone,locked,source,sync_status,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,0,'local','local',?,?
       WHERE NOT EXISTS (
         SELECT 1 FROM schedule_entries
         WHERE owner_id = ? AND scheduled_date = ? AND start_time < ? AND end_time > ?
       )`,
    ).bind(id, owner, body.task_id, body.title, body.scheduled_date, body.start_time, body.end_time, body.timezone,
      now, now, owner, body.scheduled_date, body.end_time, body.start_time).run()
    if (!result.meta.changes) return responseError(409, 'schedule_conflict', 'That time overlaps an existing schedule entry', corsHeaders)
    const entry = await env.DB.prepare('SELECT * FROM schedule_entries WHERE owner_id = ? AND id = ?').bind(owner, id).first()
    return responseJson(entry, 201, corsHeaders)
  }

  const entryMatch = url.pathname.match(/^\/api\/schedule\/([^/]+)$/)
  if (entryMatch && request.method === 'DELETE') {
    const entry = await env.DB.prepare('SELECT * FROM schedule_entries WHERE owner_id = ? AND id = ?').bind(owner, entryMatch[1]).first<ScheduleEntry>()
    if (!entry) return responseError(404, 'schedule_entry_not_found', 'Schedule entry not found', corsHeaders)
    if (entry.source === 'google') return responseError(409, 'external_event_read_only', 'Google events must be changed through calendar sync', corsHeaders)
    await env.DB.prepare('DELETE FROM schedule_entries WHERE owner_id = ? AND id = ?').bind(owner, entry.id).run()
    return responseJson({ success: true }, 200, corsHeaders)
  }

  if (url.pathname === '/api/schedule/plan' && request.method === 'POST') {
    const payload = await readBody(request)
    if (!payload.ok) return responseError(400, 'invalid_json', 'Request body must be valid JSON', corsHeaders)
    const validation = validateDailyPlan(payload.data)
    if (!validation.success) return responseJson(validation.error, 400, corsHeaders)

    const body = validation.data
    const [{ results: taskRows }, { results: existingRows }] = await Promise.all([
      env.DB.prepare(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY created_at`).all(),
      env.DB.prepare('SELECT * FROM schedule_entries WHERE owner_id = ? AND scheduled_date = ? ORDER BY start_time').bind(owner, body.date).all(),
    ])
    const preserved = (existingRows as unknown as ScheduleEntry[]).filter((entry) => entry.locked || entry.source !== 'local')
    const { planned, unscheduled } = buildDailyPlan(taskRows as unknown as Task[], preserved, body.date, body.workday_start, body.workday_end)
    const now = new Date().toISOString()
    const writes: D1PreparedStatement[] = [
      env.DB.prepare(`DELETE FROM schedule_entries WHERE owner_id = ? AND scheduled_date = ? AND source = 'local' AND locked = 0`).bind(owner, body.date),
      ...planned.map((block) => env.DB.prepare(
        `INSERT INTO schedule_entries
         (id,owner_id,task_id,title,scheduled_date,start_time,end_time,timezone,locked,source,sync_status,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?,?,0,'local','local',?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM schedule_entries
           WHERE owner_id = ? AND scheduled_date = ? AND start_time < ? AND end_time > ?
         )`,
      ).bind(crypto.randomUUID(), owner, block.task.id, block.task.title, body.date, block.start_time, block.end_time,
        body.timezone, now, now, owner, body.date, block.end_time, block.start_time)),
    ]
    await env.DB.batch(writes)
    const { results } = await selectDay(env.DB, owner, body.date)
    return responseJson({ date: body.date, timezone: body.timezone, entries: results, unscheduled }, 200, corsHeaders)
  }

  return responseError(405, 'schedule_method_not_allowed', 'Schedule method is not allowed', corsHeaders)
}
