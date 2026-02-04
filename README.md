# Eris – Personal Productivity Assistant

Eris is a personal productivity assistant built on Cloudflare. It combines a React UI with a Cloudflare Worker + D1 database and Workers AI to parse natural language, enrich tasks, and keep everything in sync.

## Features
- Natural language task entry (Parse) that pre-fills the Create Task form.
- Task table with inline editing, batch actions, and AI-powered enrichments.
- AI tools: suggest priority, estimate duration, categorize task, and an orchestrated full-assist flow.
- Durable Object hook (`CommandParserDO`) for future context-aware parsing.
- Cloudflare D1 persistence with migrations and indexed queries.
- Clean, dark UI with consistent UX for edit/save and batch actions.

## Architecture
- **Frontend (app/)**: Vite + React + MUI UI, calling a Worker API.
- **Backend (worker/)**: Cloudflare Worker with REST endpoints, D1 for storage, and Workers AI for inference.
- **Durable Objects**: `CommandParserDO` exists for context/history parsing (available for future use).

## AI Usage
Workers AI is invoked via the `AI` binding in the Worker (`wrangler.toml`). The current model is:
- `@cf/meta/llama-3-8b-instruct`

AI endpoints:
- `POST /api/ai/parse-task`
- `POST /api/ai/suggest-priority`
- `POST /api/ai/estimate-duration`
- `POST /api/ai/categorize-task`
- `POST /api/ai/full-assist` (parse → priority → categorize → estimate → persist)

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
`CommandParserDO` is registered and ready for contextual parsing and multi-turn history. The current parse route uses direct AI calls but the DO can be wired in for richer context and long-lived state.