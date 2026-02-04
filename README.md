# cf_ai_eris

Hello, this is a personal productivity assistant, Eris.

## Project Progress
- UI: Dark MUI layout with inline-editable task table; natural-language Parse jumps straight to the Create Task form with prefilled fields.
- Forms: Task create form with category/subcategory, priority/status, due date, est. duration, note; reset/create actions.
- Data: Cloudflare D1 migrations for tasks, schedule entries, analytics aggregates, ai_requests; binding `DB` configured in wrangler.toml.
- AI endpoints: `/api/ai/parse-task`, `/api/ai/suggest-priority`, `/api/ai/estimate-duration`, `/api/ai/categorize-task`; orchestrated `/api/ai/full-assist` chains parse → priority → categorize → estimate → persist to D1.
- Model: prefers `@cf/meta/llama-3.3-8b-instruct` with fallback to `@cf/meta/llama-3-8b-instruct`.
- Services/tests: Frontend services call Worker CRUD/AI; Vitest covers taskService and TaskTable edit/delete flows.

## Durable Object
- `CommandParserDO` is available for parsing context/history; current parse endpoint uses direct AI calls with fallback, keeping DO available for future contextual parsing.

## Data
- Persistence: Cloudflare D1 (`tasks`, `schedule_entries`, `analytics_aggregates`, `ai_requests`) with migrations in `worker/db/migrations` and binding `DB` configured in `wrangler.toml`.
- AI: Workers AI binding `AI` (remote) using Llama 3.3 instruct; Durable Object `CommandParserDO` provides parsing context.