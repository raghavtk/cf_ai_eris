import { AiPrivacyError, aiService, type AiRequestOptions } from './ai/aiService'
import { CommandParserDO } from './durable-objects/CommandParserDO'
import { clampMetricsLimit, logAiRequest } from './observability'
import { validateCreateTask, validateTaskTextInput, validateUpdateTask } from '../../shared/contracts'
import type { ApiError, CreateTaskInput } from '../../shared/contracts'
import { handleScheduleRequest, type ScheduleEnv } from './routes/schedule'
import { getScheduleOwner, isLocalDevRequest, type ScheduleAccessEnv } from './auth/scheduleAccess'

interface Env extends ScheduleEnv, ScheduleAccessEnv {
  AI: any
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  COMMAND_PARSER: DurableObjectNamespace
  ERIS_ALLOWED_ORIGIN?: string
}

const baseCorsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Credentials': 'true',
  Vary: 'Origin',
}

const json = (data: unknown, status = 200, corsHeaders: Record<string, string> = baseCorsHeaders) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })

const notFound = (corsHeaders: Record<string, string>) => new Response('Not Found', { status: 404, headers: corsHeaders })

const apiError = (status: number, code: string, error: string, corsHeaders: Record<string, string>, details?: Record<string, string>) =>
  json({ error, code, ...(details ? { details } : {}) } satisfies ApiError, status, corsHeaders)

const readJson = async (request: Request, corsHeaders: Record<string, string>) => {
  try {
    return { success: true as const, data: await request.json() }
  } catch {
    return { success: false as const, response: apiError(400, 'invalid_json', 'Request body must be valid JSON', corsHeaders) }
  }
}

const readAiOptions = (value: unknown): AiRequestOptions | ApiError => {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const provider = body.provider
  if (provider !== undefined && provider !== 'workers-ai' && provider !== 'openai') {
    return { error: 'Invalid AI provider', code: 'invalid_ai_provider' }
  }
  for (const field of ['allowOpenAISensitive', 'includeWorkContext'] as const) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      return { error: `Invalid ${field}`, code: 'invalid_ai_privacy_option' }
    }
  }
  return { provider: provider as AiRequestOptions['provider'], allowOpenAISensitive: body.allowOpenAISensitive === true, includeWorkContext: body.includeWorkContext === true }
}

const isApiError = (value: AiRequestOptions | ApiError): value is ApiError => 'code' in value
const aiFailure = (error: unknown, fallback: string, corsHeaders: Record<string, string>) =>
  error instanceof AiPrivacyError ? apiError(400, error.code, 'OpenAI privacy consent is required for this request', corsHeaders) : json({ error: fallback }, 502, corsHeaders)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const origin = request.headers.get('Origin')
    const localDev = isLocalDevRequest(request, env)
    const allowedOrigin = env.ERIS_ALLOWED_ORIGIN || 'http://localhost:5173'
    if (origin && origin !== allowedOrigin && !(localDev && origin === 'http://localhost:5173')) {
      return apiError(403, 'origin_not_allowed', 'Origin is not allowed', baseCorsHeaders)
    }
    const corsHeaders = { ...baseCorsHeaders, 'Access-Control-Allow-Origin': origin || allowedOrigin }
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

    const owner = await getScheduleOwner(request, env)
    if (!owner) return apiError(401, 'authentication_required', 'Authentication is required', corsHeaders)
    if (!localDev && !env.ERIS_ALLOWED_ORIGIN) {
      return apiError(503, 'access_not_configured', 'Access configuration is incomplete', corsHeaders)
    }

    if (path === '/api/auth/session' && request.method === 'GET') {
      return json({ authenticated: true, owner }, 200, corsHeaders)
    }
    if (path === '/api/auth/login' && request.method === 'GET') {
      if (!env.ERIS_ALLOWED_ORIGIN) return apiError(503, 'auth_return_not_configured', 'Authentication return is not configured', corsHeaders)
      const returnUrl = new URL(env.ERIS_ALLOWED_ORIGIN)
      returnUrl.searchParams.set('access', 'granted')
      return Response.redirect(returnUrl.toString(), 302)
    }

    const scheduleResponse = await handleScheduleRequest(request, env, owner, corsHeaders)
    if (scheduleResponse) return scheduleResponse

    // Root ping
    if (path === '/') return new Response('Eris Worker is running', { status: 200, headers: corsHeaders })

    // ----- Tasks CRUD -----
    if (path === '/api/tasks' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
      return json(results, 200, corsHeaders)
    }

    if (path === '/api/tasks' && request.method === 'POST') {
      const payload = await readJson(request, corsHeaders)
      if (!payload.success) return payload.response
      const validation = validateCreateTask(payload.data)
      if (!validation.success) return json(validation.error, 400, corsHeaders)
      const body = validation.data
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await env.DB.prepare(
        `INSERT INTO tasks (id,title,description,priority,status,category,subcategory,due_date,estimated_duration,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          id,
          body.title,
          body.description,
          body.priority,
          body.status,
          body.category,
          body.subcategory,
          body.due_date,
          body.estimated_duration,
          body.note,
          now,
          now,
        )
        .run()
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      return json(task, 201, corsHeaders)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'GET') {
      const id = path.split('/').pop()
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      return task ? json(task, 200, corsHeaders) : apiError(404, 'task_not_found', 'Task not found', corsHeaders)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'PUT') {
      const id = path.split('/').pop()
      const payload = await readJson(request, corsHeaders)
      if (!payload.success) return payload.response
      const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      if (!existing) return apiError(404, 'task_not_found', 'Task not found', corsHeaders)

      const validation = validateUpdateTask(payload.data, existing as unknown as CreateTaskInput)
      if (!validation.success) return json(validation.error, 400, corsHeaders)

      const now = new Date().toISOString()
      const merged = validation.data

      await env.DB.prepare(
        `UPDATE tasks SET title=?,description=?,priority=?,status=?,category=?,subcategory=?,due_date=?,estimated_duration=?,note=?,updated_at=? WHERE id=?`,
      )
        .bind(
          merged.title,
          merged.description,
          merged.priority,
          merged.status,
          merged.category,
          merged.subcategory,
          merged.due_date,
          merged.estimated_duration,
          merged.note,
          now,
          id,
        )
        .run()
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      return task ? json(task, 200, corsHeaders) : json({ error: 'Task not found' }, 404, corsHeaders)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'DELETE') {
      const id = path.split('/').pop()
      await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
      return json({ success: true }, 200, corsHeaders)
    }

    // ----- AI Endpoints -----
    if (path === '/api/ai/parse-task' && request.method === 'POST') {
      let body: { input?: unknown; sessionId?: unknown } & AiRequestOptions
      try {
        body = (await request.json()) as { input?: unknown; sessionId?: unknown }
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, corsHeaders)
      }
      const input = typeof body.input === 'string' ? body.input.trim() : ''
      if (!input || input.length > 4000) {
        return json({ error: 'Input must contain between 1 and 4000 characters' }, 400, corsHeaders)
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      const options = readAiOptions(body)
      if (isApiError(options)) return json(options, 400, corsHeaders)
      const startedAt = Date.now()
      try {
        const doName = sessionId?.trim() || 'global-session'
        const id = env.COMMAND_PARSER.idFromName(doName)
        const obj = env.COMMAND_PARSER.get(id)
        const doRes = await obj.fetch('http://do/parse', {
          method: 'POST',
          body: JSON.stringify({ input, ...options }),
        })
        if (!doRes.ok) {
          if (doRes.status === 400) {
            const failure = await doRes.json() as Record<string, unknown>
            await logAiRequest(env.DB, {
              kind: 'parse-task',
              status: 'error',
              durationMs: Date.now() - startedAt,
              errorCode: typeof failure?.code === 'string' ? failure.code : 'parse_task_invalid',
              model: 'unknown',
            })
            return json(failure, 400, corsHeaders)
          }
          throw new Error(`Command parser failed with HTTP ${doRes.status}`)
        }
        const result = (await doRes.json()) as any
        if (!result?.parsed || typeof result.parsed !== 'object' || Array.isArray(result.parsed)) {
          throw new Error('Command parser returned an invalid response')
        }
        await logAiRequest(env.DB, {
          kind: 'parse-task',
          status: 'success',
          durationMs: Number(result?.telemetry?.duration_ms) || Date.now() - startedAt,
          model: result?.telemetry?.model ? `${result?.telemetry?.provider || 'workers-ai'}:${result.telemetry.model}` : 'unknown',
        })
        return json(result, 200, corsHeaders)
      } catch (err: any) {
        await logAiRequest(env.DB, {
          kind: 'parse-task',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'parse_task_failed',
          model: 'unknown',
        })
        return aiFailure(err, 'parse-task failed', corsHeaders)
      }
    }

    if (path === '/api/ai/suggest-priority' && request.method === 'POST') {
      const payload = await readJson(request, corsHeaders)
      if (!payload.success) return payload.response
      const validation = validateTaskTextInput(payload.data)
      if (!validation.success) return json(validation.error, 400, corsHeaders)
      const options = readAiOptions(payload.data)
      if (isApiError(options)) return json(options, 400, corsHeaders)
      const startedAt = Date.now()
      try {
        const response = await aiService.suggestPriorityWithMeta(validation.data, env, options)
        await logAiRequest(env.DB, {
          kind: 'suggest-priority',
          status: 'success',
          durationMs: Date.now() - startedAt,
          model: `${response.provider}:${response.model}`,
        })
        const result = response.data
        return json(result, 200, corsHeaders)
      } catch (err: any) {
        await logAiRequest(env.DB, {
          kind: 'suggest-priority',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'suggest_priority_failed',
        })
        return aiFailure(err, 'suggest-priority failed', corsHeaders)
      }
    }

    if (path === '/api/ai/full-assist' && request.method === 'POST') {
      let body: { input?: unknown } & AiRequestOptions
      try {
        body = (await request.json()) as { input?: unknown }
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, corsHeaders)
      }
      const input = typeof body.input === 'string' ? body.input.trim() : ''
      if (!input || input.length > 4000) {
        return json({ error: 'Input must contain between 1 and 4000 characters' }, 400, corsHeaders)
      }
      const options = readAiOptions(body)
      if (isApiError(options)) return json(options, 400, corsHeaders)
      const startedAt = Date.now()
      try {
        // Step 1: Parse NL into structured fields
        const parsedResponse = await aiService.parseTaskWithMeta(input, env, options)
        const parsedRaw = parsedResponse.data
        const parsed = (parsedRaw as any)?.parsed ?? parsedRaw ?? {}

        // Step 2: Fill minimal fields for follow-on prompts
        const title = parsed.title || 'Untitled task'
        const description = parsed.description || ''
        const dueDate = parsed.due_date || ''

        // Step 3: AI enrichments
        const [priorityResponse, categoryResponse, estimateResponse] = await Promise.all([
          aiService.suggestPriorityWithMeta({ title, description, due_date: dueDate }, env, options),
          aiService.categorizeTaskWithMeta({ title, description }, env, options),
          aiService.estimateDurationWithMeta({ title, description }, env, options),
        ])

        const priorityRes = priorityResponse.data
        const categoryRes = categoryResponse.data
        const estimateRes = estimateResponse.data

        const priority = ((priorityRes as any)?.priority || (priorityRes as any)?.priority_label || (priorityRes as any)?.suggestion || parsed.priority || 'medium')
          .toString()
          .toLowerCase()
        const category = ((categoryRes as any)?.category || (categoryRes as any)?.category_label || parsed.category || 'work')
          .toString()
          .toLowerCase()
        const subcategory = (categoryRes as any)?.subcategory || (categoryRes as any)?.sub_category || parsed.subcategory || 'Courses'
        const estimatedDuration =
          (estimateRes as any)?.estimated_minutes ||
          (estimateRes as any)?.estimated_duration ||
          (estimateRes as any)?.estimatedMinutes ||
          parsed.estimated_duration ||
          0

        // Step 4: persist to D1
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        await env.DB.prepare(
          `INSERT INTO tasks (id,title,description,priority,status,category,subcategory,due_date,estimated_duration,note,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
          .bind(
            id,
            title,
            description,
            priority,
            parsed.status || 'pending',
            category,
            subcategory,
            dueDate,
            Number(estimatedDuration) || 0,
            parsed.note || '',
            now,
            now,
          )
          .run()

        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
        await logAiRequest(env.DB, {
          kind: 'full-assist',
          status: 'success',
          durationMs: Date.now() - startedAt,
          model: [parsedResponse, priorityResponse, categoryResponse, estimateResponse]
            .map((response) => `${response.provider}:${response.model}`)
            .join(', '),
        })
        return json({ task, parsed, priority: priorityRes, category: categoryRes, estimate: estimateRes }, 201, corsHeaders)
      } catch (err: any) {
        await logAiRequest(env.DB, {
          kind: 'full-assist',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'full_assist_failed',
        })
        return aiFailure(err, 'full-assist failed', corsHeaders)
      }
    }

    if (path === '/api/ai/estimate-duration' && request.method === 'POST') {
      const payload = await readJson(request, corsHeaders)
      if (!payload.success) return payload.response
      const validation = validateTaskTextInput(payload.data)
      if (!validation.success) return json(validation.error, 400, corsHeaders)
      const options = readAiOptions(payload.data)
      if (isApiError(options)) return json(options, 400, corsHeaders)
      const startedAt = Date.now()
      try {
        const response = await aiService.estimateDurationWithMeta(validation.data, env, options)
        await logAiRequest(env.DB, {
          kind: 'estimate-duration',
          status: 'success',
          durationMs: Date.now() - startedAt,
          model: `${response.provider}:${response.model}`,
        })
        const result = response.data
        return json(result, 200, corsHeaders)
      } catch (err: any) {
        await logAiRequest(env.DB, {
          kind: 'estimate-duration',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'estimate_duration_failed',
        })
        return aiFailure(err, 'estimate-duration failed', corsHeaders)
      }
    }

    if (path === '/api/ai/categorize-task' && request.method === 'POST') {
      const payload = await readJson(request, corsHeaders)
      if (!payload.success) return payload.response
      const validation = validateTaskTextInput(payload.data)
      if (!validation.success) return json(validation.error, 400, corsHeaders)
      const options = readAiOptions(payload.data)
      if (isApiError(options)) return json(options, 400, corsHeaders)
      const startedAt = Date.now()
      try {
        const response = await aiService.categorizeTaskWithMeta(validation.data, env, options)
        await logAiRequest(env.DB, {
          kind: 'categorize-task',
          status: 'success',
          durationMs: Date.now() - startedAt,
          model: `${response.provider}:${response.model}`,
        })
        const result = response.data
        return json(result, 200, corsHeaders)
      } catch (err: any) {
        await logAiRequest(env.DB, {
          kind: 'categorize-task',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'categorize_task_failed',
        })
        return aiFailure(err, 'categorize-task failed', corsHeaders)
      }
    }

    if (path === '/api/metrics/ai/summary' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT kind,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
                ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
                MAX(duration_ms) AS max_duration_ms
         FROM ai_requests
         GROUP BY kind
         ORDER BY total DESC`,
      ).all()
      return json({ updated_at: new Date().toISOString(), metrics: results }, 200, corsHeaders)
    }

    if (path === '/api/metrics/ai/recent' && request.method === 'GET') {
      const limit = clampMetricsLimit(url.searchParams.get('limit'))
      const { results } = await env.DB.prepare(
        `SELECT id, kind, status, duration_ms, model, created_at, error_message
         FROM ai_requests
         ORDER BY created_at DESC
         LIMIT ?`,
      )
        .bind(limit)
        .all()
      return json({ updated_at: new Date().toISOString(), requests: results }, 200, corsHeaders)
    }

    return notFound(corsHeaders)
  },
}

export { CommandParserDO }
