# Eris – Personal Productivity Assistant

Eris is a personal productivity assistant built on Cloudflare. It combines a React UI with a Cloudflare Worker + D1 database and Workers AI to parse natural language, enrich tasks, and keep everything in sync.

## Features
- Natural language task entry (Parse) that pre-fills the Create Task form.
- Task table with inline editing, batch actions, and AI-powered enrichments.
- AI tools: suggest priority, estimate duration, categorize task, and an orchestrated full-assist flow.
- Bounded multi-turn parsing context through `CommandParserDO`.
- Cloudflare D1 persistence with migrations and indexed queries.
- Clean, dark UI with consistent UX for edit/save and batch actions.

## Architecture
- **Frontend (app/)**: Vite + React + MUI UI, calling a Worker API.
- **Backend (worker/)**: Cloudflare Worker with REST endpoints, D1 for storage, and Workers AI for inference.
- **Durable Objects**: `CommandParserDO` stores the four most recent successful parsing turns per client session.

## AI Usage
Workers AI is invoked via the `AI` binding in the Worker (`wrangler.toml`). The current model is:
- Primary: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Fallback: `@cf/meta/llama-3-8b-instruct`

AI endpoints:
- `POST /api/ai/parse-task`
- `POST /api/ai/suggest-priority`
- `POST /api/ai/estimate-duration`
- `POST /api/ai/categorize-task`
- `POST /api/ai/full-assist` (parse → priority → categorize → estimate → persist)

Observability endpoints:
- `GET /api/metrics/ai/summary`
- `GET /api/metrics/ai/recent?limit=20`

These endpoints currently require the same deployment-level protection as the task API. Do not expose or deploy them publicly until the single-user access boundary is configured.

## Cloudflare Assignment Mapping
This project is aligned to the optional Cloudflare AI-powered application assignment requirements.

1. **LLM integration (Workers AI / Llama 3.3)**
- Implemented in `worker/src/ai/aiService.ts` with a Llama 3.3 primary model and fallback model.

2. **Workflow / coordination (Workers or Durable Objects)**
- Implemented in `worker/src/index.ts` (Worker API orchestration) and `worker/src/durable-objects/CommandParserDO.ts` (session context + multi-turn parsing).

3. **User input via chat or voice**
- Implemented as natural-language text input in a Raycast-style palette (`Cmd/Ctrl+K`) in `app/src/components/NaturalLanguageInput.tsx`.
- Includes compact, bounded thread context for follow-up commands.

4. **Memory or state**
- Implemented via Durable Object session history and persistent D1 storage (`tasks`, `schedule_entries`, `analytics_aggregates`, `ai_requests`).

## Measurable Evals
Benchmark fixtures and runner live under `worker/scripts`.

- Cases file: `worker/scripts/benchmark-cases.json`
- Runner: `worker/scripts/benchmark-ai.js`
- Command:

```bash
cd worker
npm run benchmark
```

The benchmark reports:
- Transport success rate
- Full case pass rate
- Semantic assertion pass rate
- Required-field completeness percentage
- Latency (`avg`, `p50`, `p95`)

Each fixture defines required fields plus semantic assertions for values that can be judged reliably, such as explicit priority, category, and duration. The command exits non-zero unless every case passes. Benchmark output is environment- and model-dependent, so record a dated snapshot only after running against the intended deployment.

## Durable Object Memory Story (Deterministic Example)
Session memory is managed by `CommandParserDO` and bounded to recent history. The parse route can apply follow-up edits to the last parsed task.

Example flow:

1. Turn 1 input:
`"Book dentist appointment next Tuesday"`

2. Parsed output (example):

```json
{
	"title": "Book dentist appointment",
	"priority": "medium",
	"category": "personal",
	"subcategory": "Health",
	"due_date": "<next Tuesday>",
	"estimated_duration": 60,
	"note": null
}
```

3. Turn 2 follow-up:
`"make it high priority and 45 minutes"`

4. Merged output (example):

```json
{
	"title": "Book dentist appointment",
	"priority": "high",
	"category": "personal",
	"subcategory": "Health",
	"due_date": "<next Tuesday>",
	"estimated_duration": 45,
	"note": null
}
```

Memory path:
`NaturalLanguageInput -> /api/ai/parse-task -> CommandParserDO -> aiService.parseWithHistory`

Reset behavior:
- `new session` in the palette resets the current client session id.
- Persisted tasks in D1 are not deleted by session resets.

## AI Request Observability
Each AI endpoint write records to `ai_requests` with:
- an opaque request ID
- `kind`
- `status` (`success` or `error`)
- `duration_ms`
- `model`
- a bounded machine-readable error code (if any)

Task text and model output are not stored in AI telemetry. Telemetry failures are reported to operational logs but do not change the user-facing AI response.


## Data Model (D1)
Primary tables:
- `tasks`
- `schedule_entries`
- `analytics_aggregates`
- `ai_requests`

Migrations live in [worker/db/migrations](worker/db/migrations).

## Running locally

### Prerequisites
- Node.js 18+
- Cloudflare Wrangler (`npm i -g wrangler`) or use the local dev dependency in `worker/`

### 1) Install dependencies
```bash
cd app
npm install

cd ../worker
npm install
```

### 2) Configure local API URL
Create/update [app/.env.local](app/.env.local):
```dotenv
VITE_API_URL=http://localhost:8787
```

### 3) Set up D1
In the Worker folder, create/verify your D1 database and run migrations:
```bash
wrangler d1 create productivity-db
wrangler d1 migrations apply productivity-db
```
Ensure the `database_id` in [worker/wrangler.toml](worker/wrangler.toml) matches your created DB.

### 4) Run the Worker (API)
```bash
cd worker
npm run dev
```
The Worker should be available at `http://localhost:8787`.

### 5) Run the frontend
```bash
cd app
npm run dev
```
The UI should be available at `http://localhost:5173` and will call the Worker API.

## Deployment notes
### Worker
Deploy from the worker folder:
```bash
cd worker
npm run deploy
```

### Pages (frontend)
When deploying to Cloudflare Pages, set a production env var:
```
VITE_API_URL=https://<your-worker>.workers.dev
```
Then rebuild/redeploy so the built frontend points to the remote Worker.

## Repository structure
- `app/` – Vite + React UI
- `worker/` – Worker API + D1 + AI
- `worker/db/migrations/` – D1 schema migrations

## Durable Object
`CommandParserDO` is registered and used by `/api/ai/parse-task` for bounded contextual parsing and multi-turn history. Starting a new client session selects a new Durable Object; it does not delete persisted tasks.
