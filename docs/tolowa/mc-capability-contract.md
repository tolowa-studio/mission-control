# Mission Control API — Capability Contract

Source: `~/services/mission-control-poc/openapi.json` on `m2-mini` — **Mission Control API v1.3.0**, 144 paths. Read entirely via targeted `jq` queries over SSH (file not loaded into context). Every finding below is marked **VERIFIED** (with the `jq` query and raw result it rests on) or **UNKNOWN** (spec does not say — not inferred).

## Bottom line

- **No task hierarchy exists.** The `Task` schema has no `parent_id`, `children`, `depends_on`, `epic`, or `project_id` field — only a flat, free-text `tags: string[]` array. `/api/projects/{id}/tasks` groups tasks by project at the API-route level, but the returned `Task` object itself carries no project reference field.
- **Mission Control can already be used as an external dispatch layer, but only through the pipeline surface, not the task-queue surface.** `/api/tasks/queue` is a pull-only poll endpoint for agents to fetch work — there is no push/enqueue call. The genuine hand-off-and-collect path is `POST /api/pipelines` (define) → `POST /api/pipelines/run` (dispatch, returns `run_id`) → `GET /api/pipelines/run?id=` (poll status/result).
- **Two separate, uneven approval gates.** `/api/quality-review` is fully specified (`task_id`, `status: approved|rejected`, `notes`) and is explicitly the "Quality review gate for tasks" per the spec's own tag description. `/api/exec-approvals` has GET/POST/PUT verbs but **zero documented request or response schema** anywhere in the spec — its actual gating semantics are UNKNOWN from this document alone.
- **Evidence capture is weak for structured links and task-bound files.** Task comments are a single free-text `content` string with no dedicated URL/link field, and no file-upload endpoint is bound to a task anywhere in the spec — file operations (`/api/agents/{id}/files`) are bound only to agents, and even that endpoint has no documented field-level schema.
- **Auth is a simple either/or** (`x-api-key` header OR `__Host-mc-session` cookie) applied globally to nearly every route; only 6 of 144 paths are explicitly unauthenticated (login/OAuth start, docs, health, status, release-check) — there is no scope/role distinction visible in the spec between human and agent callers.

---

## 1. Task model

**VERIFIED** — `jq '.components.schemas.Task' openapi.json`

```json
{
  "id": "integer",
  "title": "string",
  "description": "string",
  "status": "string enum: [inbox, assigned, in_progress, quality_review, done]",
  "priority": "string enum: [critical, high, medium, low]",
  "assigned_to": "string",
  "created_by": "string",
  "due_date": "string",
  "estimated_hours": "number",
  "tags": "array<string>",
  "metadata": "object (opaque, untyped)",
  "created_at": "integer",
  "updated_at": "integer"
}
```

This is the complete field set — confirmed identical across `GET /api/tasks/{id}`, `POST /api/tasks` (create), and `PUT /api/tasks/{id}` (update) request/response bodies.

**Parent/child, subtask, dependency, grouping fields: NONE found. VERIFIED.**
Ran a document-wide structural search:
```
jq '[paths(scalars) as $p | select(getpath($p)|tostring|test("project_id")) ...]'
jq '[paths as $p | select($p[-1]=="project_id") | $p]'
```
combined with a substring grep over the stringified document for `parent_id|parent_task|children|subtask|sub_task|depends_on|dependency|dependencies|epic|project_id|blocked_by|blocking`. The only hit for any of these terms in the entire 144-path spec is a single `project_id` property on `POST /api/github/sync` (a GitHub-sync request field, unrelated to task modeling). No `parent_id`, `children`, `depends_on`, `epic`, `blocked_by`/`blocking` token appears anywhere in the document.

Grouping does exist at the **route** level, not the **schema** level: `GET /api/projects/{id}/tasks` lists a project's tasks, and there's a `Project` schema (`id`, `name`, `description`, `created_at`, `updated_at`) — but the `Task` object returned by that route is the same flat `Task` schema above, with no `project_id` echoed back on the task itself.

**Status enum (exact): VERIFIED** — `inbox`, `assigned`, `in_progress`, `quality_review`, `done`. Identical enum appears on `Task.status`, `POST /api/tasks` request, and `POST /api/quality-review` is what moves a task out of `quality_review`.

**Owner/assignee: VERIFIED.** `assigned_to` (string) and `created_by` (string) — both plain strings, not typed foreign keys to `Agent.id`/`User.id`. No separate `owner` field.

**Priority: VERIFIED.** `critical`, `high`, `medium`, `low` (default `medium` on create).

**Resolution / acceptance criteria: UNKNOWN / absent.** No `resolution`, `acceptance_criteria`, `outcome`, or `result` field exists on the `Task` schema. (There is a separate, unrelated `/api/tasks/outcomes` path and `/api/tasks/regression` path whose schemas were not part of this question's scope and were not deep-dived; the core `Task` object itself has no such fields.)

---

## 2. Evidence — comments and agent files

### `/api/tasks/{id}/comments` — VERIFIED (full schema captured)

- `GET`: returns `{ comments: [{ id: integer, task_id: integer, author: string, content: string, created_at: integer }] }`
- `POST`: request body `{ content: string (required), author: string (optional) }` → `201` with `{ comment: object }` (response shape for the created comment is left as untyped `object` in the spec, unlike the GET list items).

**Structured link/URL field: NO. VERIFIED.** The comment schema has exactly one text field (`content`) and an `author` string — no `url`, `link`, `href`, or attachment-reference property anywhere in the comment schema, request, or response. A URL could only be embedded as plain text inside `content`.

### `/api/agents/{id}/files` — PARTIALLY UNKNOWN

`GET` and `PUT` both exist, tagged "API", operationIds `get_api_agents_id_files` / `put_api_agents_id_files`. **VERIFIED that the spec documents no field-level schema for either**: `GET` responses list only status codes with generic descriptions ("OK", "Bad request", etc.) and no `content`/schema block; `PUT` requestBody is `{ "type": "object" }` with no `properties` at all. What this endpoint actually accepts/returns (file path? content? encoding?) is **UNKNOWN** from the spec — it is real estate, not a documented contract.

### Task-bound file upload: NONE EXISTS. VERIFIED.
Searched all 144 paths for `file|upload|attach` (case-insensitive):
```
jq -r '.paths | keys[] | select(test("file|upload|attach"; "i"))'
```
Only two matches in the entire spec: `/api/agents/{id}/files` (agent-bound, as above) and `/api/pty/attach` (a PTY/terminal attach, unrelated to task evidence). **There is no `/api/tasks/{id}/files` or any task-scoped upload/attachment endpoint anywhere in the spec.**

---

## 3. Approvals — `/api/exec-approvals` vs `/api/quality-review`

### `/api/quality-review` — fully documented. VERIFIED.

- Tag: `Quality`, with the spec's own root-level tag description: **"Quality review gate for tasks."**
- `GET`: query param `task_id` (integer, "Filter by task") → `200 Quality review list` (response body itself untyped in the spec, but the filter parameter confirms task-scoping).
- `POST` (`submitQualityReview`): request body `{ task_id: integer (required), status: enum[approved, rejected] (required), notes: string (optional) }` → `200 Review submitted`.
- This is the mechanism that resolves a task sitting in the `Task.status = "quality_review"` state.

### `/api/exec-approvals` — undocumented shape. VERIFIED (as to what's NOT there).

- Tag: `Admin` (root tag description: "System administration and configuration" — a generic catch-all, not approval-specific).
- `GET`, `POST`, `PUT` all exist (`getApiExecApprovals`, `postApiExecApprovals`, `putApiExecApprovals`) but **every one of them has zero requestBody and zero response schema** — responses are bare `{"200": {"description": "OK"}}` with no `content` block at all, and POST/PUT have no `requestBody` key present in the spec.
- Confirmed no other part of the document elaborates on it: a full-text grep for `exec.approval` across the stringified spec returns only the path key itself, no descriptive text elsewhere.

### Which is human-in-the-loop vs automated: UNKNOWN (cannot be determined from the spec).

The spec gives no role/actor restriction on either endpoint (both inherit the same global `sessionCookie OR apiKey` security — see §7), and neither schema names an approver type. What can be said from naming/tagging alone (not a verified behavioral fact): `quality-review` reads as the documented, task-scoped, binary approve/reject gate tied directly to the task status machine, while `exec-approvals`, sitting under the generic `Admin` tag with no schema at all, is architecturally distinct and likely gates something else (e.g., execution/administrative actions rather than task output) — but this is inference, not verified spec content. **Do not treat this paragraph as VERIFIED; it is flagged explicitly as UNKNOWN.**

---

## 4. Dispatch surface — can an external system hand off a job and collect the result?

**Answer: Yes, but only via the Pipelines surface — not via `/api/tasks/queue`, which is pull-only.**

### `/api/tasks/queue` — VERIFIED, GET only, agent-pull, not external-push.
Single `GET` operation (`pollTaskQueue`). Params: `agent` (query, optional if `x-agent-name` header given), `max_capacity` (1–20, default 1). Response: `{ task: Task|null, reason: enum[continue_current, assigned, at_capacity, no_tasks_available], agent: string, timestamp: integer }`. There is no POST/PUT on this path. **An external system cannot push a job here — this is exclusively how an already-registered agent asks "what's next for me."**

### `/api/sessions` — VERIFIED. List/manage existing sessions only; no session creation.
- `GET`: lists merged gateway+local sessions with rich telemetry (`id, key, agent, model, kind, channel, source: gateway|local, active, startTime, lastActivity, totalTokens, workingDir, userMessages, assistantMessages, toolUses, estimatedCost, lastUserPrompt, age, tokens, flags`).
- `DELETE`: body `{ sessionKey }` → deletes a session.
- `POST`: query `action: enum[set-thinking, set-verbose, set-reasoning, set-label]` + body `{ sessionKey, level?, label? }` — this is settings control on an existing session, **not** session creation.

### `/api/sessions/continue` — VERIFIED. Continues an existing *local* CLI session; not a generic remote job submission.
`POST` only. Body `{ kind: enum[claude-code, codex-cli, opencode] (required), id: string (required), prompt: string (required) }` → `{ ok: boolean, reply: string }`. Requires an `id` of an already-existing local session of one of three specific CLI tools — this presumes Mission Control (or its host) already has a live local process for that session; it is not a way to spin up new work from a cold external caller.

### `/api/sessions/{id}/control` — VERIFIED. Lifecycle control (pause/resume/kill) of an existing session.
`POST`, body `{ action: enum[pause, resume, kill] (required) }` → `{ success: boolean }`.

### `/api/claude/sessions` — VERIFIED. Registration/listing of Claude CLI sessions, not job dispatch.
`GET`: list. `POST` (`registerClaudeSession`): body `{ session_id?, agent_name?, model? }` (no field marked required in the schema) → `200 Session registered`. This registers an already-running local Claude CLI process into Mission Control's bookkeeping; it does not start new work remotely.

### `/api/agent-runtimes` — VERIFIED. Manages runtime install/detection for local agent runtimes, not remote job submission.
`GET`: "Runtime detection and active install jobs" (no schema given). `POST`: body `{ action: enum[install, job-status, docker-compose, detect], runtime: enum[openclaw, hermes, claude, codex, opencode], mode: enum[local, docker], jobId? }`. This governs installing/detecting agent runtime software on the host machine — infrastructure management, not task/job dispatch.

### `/api/pipelines/run` — VERIFIED. **This is the genuine external hand-off-and-collect mechanism.**
- `POST` (`runPipeline`): body `{ pipeline_id: integer (required), params: object (optional) }` → `200 { run_id: integer, status: string }`. This starts a pre-defined pipeline and returns immediately with a run identifier and initial status.
- `GET` (`listPipelineRuns`): query params `pipeline_id`, `id`, `limit` (default 20) → `{ runs: array<object> }`. Passing `id` (a specific run's id) lets a caller poll a specific run's status/result later.

A pipeline must first exist: `POST /api/pipelines` (`createPipeline`) — body `{ name: string (required), steps: array<{ template_id: integer (required), on_failure: enum[stop, continue] (default stop) }> (required), description? }` → `201 { pipeline: object }`. `GET /api/pipelines` lists pipelines with `id, name, description, steps[{template_id, template_name, on_failure}], created_by, use_count, runs: {total, completed, failed, running}, created_at, updated_at`.

### Exact call sequence an external system would use — VERIFIED as composed from the above:

1. `POST /api/pipelines` with `{name, steps: [{template_id, on_failure}]}` (one-time, or reuse an existing pipeline discovered via `GET /api/pipelines`) → get back a `pipeline.id`.
2. `POST /api/pipelines/run` with `{pipeline_id, params}` → get back `{run_id, status}` immediately (async dispatch).
3. Poll `GET /api/pipelines/run?id={run_id}` (or filter by `pipeline_id`) periodically → inspect the run entry's status field for completion (the exact terminal-state enum for an individual run item is not spelled out in the spec beyond the pipeline-level rollup `runs: {total, completed, failed, running}` seen on `GET /api/pipelines`).
4. Collect the result from whatever the run entry in step 3 contains — **the per-run item's full field list is UNKNOWN**: `GET /api/pipelines/run` types each item in `runs` only as a bare `object` with no properties enumerated, so the spec does not document exactly which fields (e.g., output, error, artifacts) come back on a completed run. This is the one open gap in an otherwise clear dispatch-and-collect path.

**Task creation as an alternative/complementary path (VERIFIED, supplementary):** `POST /api/tasks` (`{title (required), description?, status?, priority?, assigned_to?, created_by?, due_date?, estimated_hours?, tags?, metadata?}`) creates a task an external system could also use as a work item, and `GET /api/tasks/{id}` polls it for status/result via the same `Task` schema. This is viable for simple hand-off, but nothing in the Task schema (§1) carries structured output/result data beyond the opaque `metadata: object` — so completion detection means polling `status` until `done` and reading whatever was stuffed into `metadata`, `description`, or a comment.

---

## 5. Agents

### `/api/agents/register` — VERIFIED (full schema captured).
`POST` only (`registerAgent`). Body: `{ name: string (required, pattern ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$), role: enum[coder, reviewer, tester, devops, researcher, assistant, agent] (default agent), capabilities?: string[], framework?: string }`.
Responses: `200` "Agent already exists, status updated"; `201` with `{ agent: {id, name, role, status, created_at}, registered: boolean, message: string }`; `400` invalid input; `409` name conflict; `429` rate limited.

### Can an agent register and remain idle/dormant with no active runtime polling? — VERIFIED as consistent with "yes"; not a stated guarantee, but strongly supported by the schema.
- `Agent.status` enum is `online | offline | busy | idle | error` — `idle` and `offline` are both first-class persisted states, not transient/derived-only values.
- Nothing in the registration endpoint or the `Agent` schema requires an ongoing heartbeat/poll for the record to exist or remain queryable — `GET /api/agents/{id}/heartbeat` and `POST /api/agents/{id}/heartbeat` are separate, optional, on-demand calls (`getAgentHeartbeat` returns pending tasks/messages; `triggerAgentHeartbeat` just returns `{success: boolean}`), not a required keep-alive that the spec ties to the agent's continued existence.
- Net: **VERIFIED that the schema permits a registered agent to sit in `idle` or `offline` status indefinitely with no documented expiry or required poll-interval.** Whether some undocumented server-side TTL silently reaps stale agents is **UNKNOWN** — not addressed anywhere in the spec.

### `/api/agent-runtimes` — VERIFIED.
`GET`: "Runtime detection and active install jobs" — no field-level schema given (response has no `content` block, purely descriptive). `POST`: body `{ action: enum[install, job-status, docker-compose, detect], runtime: enum[openclaw, hermes, claude, codex, opencode], mode: enum[local, docker], jobId?: string }` — manages installing, detecting, and checking job status of runtime software for named agent frameworks (OpenClaw, Hermes, Claude, Codex, OpenCode) in either local or docker mode. This is host/runtime provisioning, distinct from the `Agent` registry itself (`/api/agents*`).

---

## 6. Cost — `/api/tokens` and `/api/tokens/by-agent`

### `/api/tokens` — VERIFIED, multi-shaped via `action` query param.
`GET` (`getTokenUsage`), params: `action: enum[list, stats, agent-costs, export, trends]` (default `list`), `timeframe: enum[hour, day, week, month, all]` (default `all`), `format: enum[json, csv]` (export only). Response is a `oneOf` of three documented shapes:
- **ListResponse**: `{ usage: TokenUsageRecord[], total: integer, timeframe: string }` where `TokenUsageRecord = {id, model, sessionId, timestamp, inputTokens, outputTokens, totalTokens, cost, operation, duration}`.
- **StatsResponse**: `{ summary: TokenStats, models: {[name]: TokenStats}, sessions: {[key]: TokenStats}, agents: {[name]: TokenStats}, timeframe, recordCount }` where `TokenStats = {totalTokens, totalCost, requestCount, avgTokensPerRequest, avgCostPerRequest}`. So stats can be sliced **by model, by session, or by agent** in one call.
- **TrendsResponse**: `{ trends: [{timestamp: string, tokens: integer, cost: number, requests: integer}], timeframe }`.

`POST` (`recordTokenUsage`): body `{ model, sessionId, inputTokens, outputTokens (all required), operation? (default chat_completion), duration? }` → writes a `TokenUsageRecord`. Note: `action=agent-costs` and `action=export` are declared as valid enum values on GET but their response shapes are not separately broken out in the `oneOf` (only list/stats/trends are) — **the exact `agent-costs` and CSV `export` response shape is UNKNOWN** from this document.

### `/api/tokens/by-agent` — VERIFIED.
`GET` only, param `days` (1–365, default 30). Response: `{ agents: [{agent: string, total_input_tokens, total_output_tokens, total_tokens, total_cost, session_count, request_count, last_active: date-time, models: object[]}], summary: {total_cost, total_tokens, agent_count, days} }`.

**Granularity: VERIFIED as — per-request record (model, session, tokens in/out, cost, operation, duration, timestamp), rollup by model / by session / by agent (via `/api/tokens?action=stats`), rollup strictly by agent over a rolling day-window with per-agent model breakdown (`/api/tokens/by-agent`), and a time-bucketed trend series (`/api/tokens?action=trends`).** No org-wide or project-wide cost dimension is exposed by either endpoint — the only groupings documented are model, session, and agent.

---

## 7. Auth

**VERIFIED** — `jq '.components.securitySchemes'` and `jq '.security'`:

```json
"securitySchemes": {
  "sessionCookie": { "type": "apiKey", "in": "cookie", "name": "__Host-mc-session" },
  "apiKey":        { "type": "apiKey", "in": "header", "name": "x-api-key" }
},
"security": [ { "sessionCookie": [] }, { "apiKey": [] } ]
```

Global security is an **OR** of the two: any request authenticated by either the `__Host-mc-session` cookie (browser/human session) or an `x-api-key` header (bearer-style API key) is accepted, applied by default across essentially all 144 paths. There is no OAuth2/JWT bearer scheme in `securitySchemes` — just these two `apiKey`-type mechanisms (one cookie-delivered, one header-delivered).

**Unauthenticated endpoints — VERIFIED, exactly 6 of 144** (found via explicit per-operation `security: []` overrides):

```
POST /api/auth/google     (OAuth entry point)
POST /api/auth/login      (credential login)
GET  /api/docs            (API documentation)
GET  /api/releases/check  (version/release check)
GET  /api/health          (health check)
GET  /api/status          (status check)
```

Every other of the 144 documented paths inherits the global `sessionCookie OR apiKey` requirement — **no other endpoint is unauthenticated**, including `/api/tasks/queue`, `/api/pipelines/run`, `/api/exec-approvals`, and `/api/quality-review`, all of which return `401 Unauthorized` (via `$ref: '#/components/responses/Unauthorized'`) when neither credential is presented.

**Scope/role distinction between human and agent callers: UNKNOWN.** The spec defines a `User.role: admin|operator|viewer` and separately an `Agent.role: coder|reviewer|tester|devops|researcher|assistant|agent`, but no endpoint's security requirement is scoped to a particular role or caller type — the same blanket `sessionCookie OR apiKey` applies everywhere security is required. Whether the server enforces role-based restrictions at runtime beyond what the OpenAPI document states cannot be determined from this spec alone.
