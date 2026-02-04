import { aiService } from './ai/aiService'
import { CommandParserDO } from './durable-objects/CommandParserDO'

interface Env {
  DB: D1Database
  AI: any
  COMMAND_PARSER: DurableObjectNamespace
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })

const notFound = () => new Response('Not Found', { status: 404, headers: corsHeaders })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

    const url = new URL(request.url)
    const path = url.pathname

    // Root ping
    if (path === '/') return new Response('Eris Worker is running', { status: 200, headers: corsHeaders })

    // ----- Tasks CRUD -----
    if (path === '/api/tasks' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
      return json(results)
    }

    if (path === '/api/tasks' && request.method === 'POST') {
      const body = (await request.json()) as any
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await env.DB.prepare(
        `INSERT INTO tasks (id,title,description,priority,status,category,subcategory,due_date,estimated_duration,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          id,
          body.title ?? '',
          body.description ?? '',
          (body.priority ?? 'medium').toString().toLowerCase(),
          (body.status ?? 'pending').toString().toLowerCase(),
          (body.category ?? 'work').toString().toLowerCase(),
          body.subcategory ?? 'Courses',
          body.due_date ?? '',
          body.estimated_duration ?? 0,
          body.note ?? '',
          now,
          now,
        )
        .run()
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      return json(task, 201)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'GET') {
      const id = path.split('/').pop()
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      return task ? json(task) : json({ error: 'Task not found' }, 404)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'PUT') {
      const id = path.split('/').pop()
      const body = (await request.json()) as any
      const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
      if (!existing) return json({ error: 'Task not found' }, 404)

      const now = new Date().toISOString()
      const merged = {
        title: body.title ?? existing.title ?? '',
        description: body.description ?? existing.description ?? '',
        priority: (body.priority ?? existing.priority ?? 'medium').toString().toLowerCase(),
        status: (body.status ?? existing.status ?? 'pending').toString().toLowerCase(),
        category: (body.category ?? existing.category ?? 'work').toString().toLowerCase(),
        subcategory: body.subcategory ?? existing.subcategory ?? 'Courses',
        due_date: body.due_date ?? existing.due_date ?? '',
        estimated_duration:
          body.estimated_duration !== undefined ? Number(body.estimated_duration) : existing.estimated_duration ?? 0,
        note: body.note ?? existing.note ?? '',
      }

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
      return task ? json(task) : json({ error: 'Task not found' }, 404)
    }

    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === 'DELETE') {
      const id = path.split('/').pop()
      await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
      return json({ success: true })
    }

    // ----- AI Endpoints -----
    if (path === '/api/ai/parse-task' && request.method === 'POST') {
      try {
        const { input } = (await request.json()) as { input: string }
        const result = await aiService.parseTask(input, env)
        return json(result)
      } catch (err: any) {
        return json({ error: 'parse-task failed', details: err?.message || String(err) }, 502)
      }
    }

    if (path === '/api/ai/suggest-priority' && request.method === 'POST') {
      const task = await request.json()
      const result = await aiService.suggestPriority(task, env)
      return json(result)
    }

    if (path === '/api/ai/full-assist' && request.method === 'POST') {
      try {
        const { input } = (await request.json()) as { input: string }

        // Step 1: Parse NL into structured fields
        const parsedRaw = await aiService.parseTask(input, env)
        const parsed = (parsedRaw as any)?.parsed ?? parsedRaw ?? {}

        // Step 2: Fill minimal fields for follow-on prompts
        const title = parsed.title || 'Untitled task'
        const description = parsed.description || ''
        const dueDate = parsed.due_date || ''

        // Step 3: AI enrichments
        const [priorityRes, categoryRes, estimateRes] = await Promise.all([
          aiService.suggestPriority({ title, description, due_date: dueDate }, env),
          aiService.categorizeTask({ title, description }, env),
          aiService.estimateDuration({ title, description }, env),
        ])

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
        return json({ task, parsed, priority: priorityRes, category: categoryRes, estimate: estimateRes }, 201)
      } catch (err: any) {
        return json({ error: 'full-assist failed', details: err?.message || String(err) }, 502)
      }
    }

    if (path === '/api/ai/estimate-duration' && request.method === 'POST') {
      const task = await request.json()
      const result = await aiService.estimateDuration(task, env)
      return json(result)
    }

    if (path === '/api/ai/categorize-task' && request.method === 'POST') {
      const task = await request.json()
      const result = await aiService.categorizeTask(task, env)
      return json(result)
    }

    return notFound()
  },
}

export { CommandParserDO }
