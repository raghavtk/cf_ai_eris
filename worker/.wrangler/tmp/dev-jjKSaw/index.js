var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-5xhKYQ/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/ai/prompts.ts
var prompts = {
  parseTask: /* @__PURE__ */ __name((input) => `
You are a task parser. Convert the following text into JSON fields:
title, description, priority (high|medium|low), due_date (ISO), category (work|personal|other), subcategory, estimated_duration (minutes), note (null).

Input: "${input}"

Return ONLY valid JSON.`, "parseTask"),
  suggestPriority: /* @__PURE__ */ __name((task) => `
You are a priority advisor. Given task:
Title: ${task.title}
Description: ${task.description}
Due Date: ${task.due_date}

Return JSON: {"priority":"high|medium|low","reason":"brief"}`, "suggestPriority"),
  estimateDuration: /* @__PURE__ */ __name((task) => `
You estimate duration in minutes. Task:
Title: ${task.title}
Description: ${task.description}

Return JSON: {"estimated_minutes": number, "confidence":"high|medium|low", "reason":"brief"}`, "estimateDuration"),
  categorizeTask: /* @__PURE__ */ __name((task) => `
Categorize task into: Work (Courses|Internship|Projects), Personal (Health|Social|Finance|Chores), Other.

Task:
Title: ${task.title}
Description: ${task.description}

Return JSON: {"category":"work|personal|other","subcategory":"one of allowed","confidence":0-1}`, "categorizeTask")
};

// src/ai/aiService.ts
var MODEL_CANDIDATES = ["@cf/meta/llama-3-8b-instruct"];
var runWithFallback = /* @__PURE__ */ __name(async (env, prompt) => {
  let lastErr;
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await env.AI.run(model, { prompt });
      return { result, model };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}, "runWithFallback");
var extractJson = /* @__PURE__ */ __name((text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/```\s*json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (_2) {
        return { raw: text };
      }
    }
    return { raw: text };
  }
}, "extractJson");
var normalize = /* @__PURE__ */ __name((res) => {
  if (res == null) return null;
  if (typeof res === "string") return extractJson(res);
  if (typeof res === "object") return res;
  return { raw: res };
}, "normalize");
var aiService = {
  async parseTask(input, env) {
    const prompt = prompts.parseTask(input);
    const { result } = await runWithFallback(env, prompt);
    return normalize(result?.response ?? result);
  },
  async suggestPriority(task, env) {
    const prompt = prompts.suggestPriority(task);
    const { result } = await runWithFallback(env, prompt);
    return normalize(result?.response ?? result);
  },
  async estimateDuration(task, env) {
    const prompt = prompts.estimateDuration(task);
    const { result } = await runWithFallback(env, prompt);
    return normalize(result?.response ?? result);
  },
  async categorizeTask(task, env) {
    const prompt = prompts.categorizeTask(task);
    const { result } = await runWithFallback(env, prompt);
    return normalize(result?.response ?? result);
  }
};

// src/durable-objects/CommandParserDO.ts
var CommandParserDO = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  static {
    __name(this, "CommandParserDO");
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/parse") return new Response("Not Found", { status: 404 });
    const { input } = await request.json();
    const parsed = await aiService.parseTask(input, this.env);
    const history = (await this.state.storage.get("history") ?? []).slice(-4);
    history.push({ input, parsed, ts: (/* @__PURE__ */ new Date()).toISOString() });
    await this.state.storage.put("history", history);
    return new Response(JSON.stringify({ parsed, history }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};

// src/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With"
};
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeaders }
}), "json");
var notFound = /* @__PURE__ */ __name(() => new Response("Not Found", { status: 404, headers: corsHeaders }), "notFound");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/") return new Response("Eris Worker is running", { status: 200, headers: corsHeaders });
    if (path === "/api/tasks" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
      return json(results);
    }
    if (path === "/api/tasks" && request.method === "POST") {
      const body = await request.json();
      const id = crypto.randomUUID();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare(
        `INSERT INTO tasks (id,title,description,priority,status,category,subcategory,due_date,estimated_duration,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id,
        body.title ?? "",
        body.description ?? "",
        (body.priority ?? "medium").toString().toLowerCase(),
        (body.status ?? "pending").toString().toLowerCase(),
        (body.category ?? "work").toString().toLowerCase(),
        body.subcategory ?? "Courses",
        body.due_date ?? "",
        body.estimated_duration ?? 0,
        body.note ?? "",
        now,
        now
      ).run();
      const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      return json(task, 201);
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === "GET") {
      const id = path.split("/").pop();
      const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      return task ? json(task) : json({ error: "Task not found" }, 404);
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === "PUT") {
      const id = path.split("/").pop();
      const body = await request.json();
      const existing = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      if (!existing) return json({ error: "Task not found" }, 404);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const merged = {
        title: body.title ?? existing.title ?? "",
        description: body.description ?? existing.description ?? "",
        priority: (body.priority ?? existing.priority ?? "medium").toString().toLowerCase(),
        status: (body.status ?? existing.status ?? "pending").toString().toLowerCase(),
        category: (body.category ?? existing.category ?? "work").toString().toLowerCase(),
        subcategory: body.subcategory ?? existing.subcategory ?? "Courses",
        due_date: body.due_date ?? existing.due_date ?? "",
        estimated_duration: body.estimated_duration !== void 0 ? Number(body.estimated_duration) : existing.estimated_duration ?? 0,
        note: body.note ?? existing.note ?? ""
      };
      await env.DB.prepare(
        `UPDATE tasks SET title=?,description=?,priority=?,status=?,category=?,subcategory=?,due_date=?,estimated_duration=?,note=?,updated_at=? WHERE id=?`
      ).bind(
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
        id
      ).run();
      const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      return task ? json(task) : json({ error: "Task not found" }, 404);
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && request.method === "DELETE") {
      const id = path.split("/").pop();
      await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
      return json({ success: true });
    }
    if (path === "/api/ai/parse-task" && request.method === "POST") {
      try {
        const { input } = await request.json();
        const result = await aiService.parseTask(input, env);
        return json(result);
      } catch (err) {
        return json({ error: "parse-task failed", details: err?.message || String(err) }, 502);
      }
    }
    if (path === "/api/ai/suggest-priority" && request.method === "POST") {
      const task = await request.json();
      const result = await aiService.suggestPriority(task, env);
      return json(result);
    }
    if (path === "/api/ai/full-assist" && request.method === "POST") {
      try {
        const { input } = await request.json();
        const parsedRaw = await aiService.parseTask(input, env);
        const parsed = parsedRaw?.parsed ?? parsedRaw ?? {};
        const title = parsed.title || "Untitled task";
        const description = parsed.description || "";
        const dueDate = parsed.due_date || "";
        const [priorityRes, categoryRes, estimateRes] = await Promise.all([
          aiService.suggestPriority({ title, description, due_date: dueDate }, env),
          aiService.categorizeTask({ title, description }, env),
          aiService.estimateDuration({ title, description }, env)
        ]);
        const priority = (priorityRes?.priority || priorityRes?.priority_label || priorityRes?.suggestion || parsed.priority || "medium").toString().toLowerCase();
        const category = (categoryRes?.category || categoryRes?.category_label || parsed.category || "work").toString().toLowerCase();
        const subcategory = categoryRes?.subcategory || categoryRes?.sub_category || parsed.subcategory || "Courses";
        const estimatedDuration = estimateRes?.estimated_minutes || estimateRes?.estimated_duration || estimateRes?.estimatedMinutes || parsed.estimated_duration || 0;
        const id = crypto.randomUUID();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        await env.DB.prepare(
          `INSERT INTO tasks (id,title,description,priority,status,category,subcategory,due_date,estimated_duration,note,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          id,
          title,
          description,
          priority,
          parsed.status || "pending",
          category,
          subcategory,
          dueDate,
          Number(estimatedDuration) || 0,
          parsed.note || "",
          now,
          now
        ).run();
        const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
        return json({ task, parsed, priority: priorityRes, category: categoryRes, estimate: estimateRes }, 201);
      } catch (err) {
        return json({ error: "full-assist failed", details: err?.message || String(err) }, 502);
      }
    }
    if (path === "/api/ai/estimate-duration" && request.method === "POST") {
      const task = await request.json();
      const result = await aiService.estimateDuration(task, env);
      return json(result);
    }
    if (path === "/api/ai/categorize-task" && request.method === "POST") {
      const task = await request.json();
      const result = await aiService.categorizeTask(task, env);
      return json(result);
    }
    return notFound();
  }
};

// ../../../../../../../../../../home/raghav/.nvm/versions/node/v20.19.5/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../../../../../../home/raghav/.nvm/versions/node/v20.19.5/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5xhKYQ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../../../../../../home/raghav/.nvm/versions/node/v20.19.5/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5xhKYQ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  CommandParserDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
