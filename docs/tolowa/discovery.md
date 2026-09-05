# Mission Control POC — Discovery

Date: 2026-09-05
Researched from official sources (GitHub repo, README, install.sh, docker-compose.yml, docs/orchestration.md).
Nothing installed. No host touched.

## 1. Identification

| Item | Value | Confidence |
|---|---|---|
| Canonical repo | `github.com/builderz-labs/mission-control` | Verified |
| Org / author | Builderz Labs (dev "nyk") | Verified |
| License | MIT © 2026 Builderz Labs | Verified |
| Language | TypeScript (Next.js 16 / React 19) | Verified |
| Stars / issues | ~6.2k / 11 open, 16 open PRs, 536 commits on main | Verified |
| Stated maturity | **Alpha.** "APIs, schemas, and configuration may change between releases." | Verified (repo's own words) |
| Exact commit evaluated | NOT YET PINNED — must be captured at clone time | Unknown |

Self-description: "Self-hosted control plane for AI agents: dispatch tasks, review runs,
track spend, and operate OpenClaw, Claude Code, Codex, and other runtimes."

Note: at least two unrelated GitHub projects are also named "mission-control"
(`crshdn/mission-control`, `wolverin0/clawtrol`). builderz-labs is the one whose stated
purpose matches this brief.

## 2. Prerequisites and install

- Node.js 22+ (install.sh checks for 20+), pnpm. Docker optional.
- Local: `git clone … && cd mission-control && bash install.sh --local`
- Docker: `docker compose up`
- Flags: `--docker` / `--local` / `--port PORT` / `--data-dir DIR` / `--dir INSTALL_DIR` / `--skip-openclaw`
- Default web UI: `http://localhost:3000/setup` (first-run admin creation)

### Privilege review of install.sh — VERIFIED
- sudo/root is used **only on Linux**, to install a systemd unit
  (`mv /tmp/mission-control.service …`, `systemctl daemon-reload`, `systemctl enable`).
- **On macOS (Darwin) no privileged path is taken.** No launchd unit is installed.
- Writes: `.env` and `.data/` (pid + logs) inside `$INSTALL_DIR`. No shell profile or PATH edits.
- Runs an "OpenClaw fleet health check and cleanup" unless `--skip-openclaw` is passed.

## 3. Architecture / Apple Silicon

- macOS + arm64 are detected explicitly by install.sh. No Rosetta or x86 dependency observed.
- Apple Silicon support: **assumed good, not yet proven.** Native install (Node) avoids
  container-arch risk entirely.

## 4. Network and auth

- Default bind: `localhost:3000` in local mode.
- **docker-compose binds `0.0.0.0`:** `ports: - "${MC_PORT:-3000}:${PORT:-3000}"` — no
  `127.0.0.1` prefix. This violates the brief's private-binding requirement as shipped and
  must be overridden.
- Auth: session cookies, API keys, Google sign-in, role-based checks.
- Repo security guidance: "Keep Mission Control on a trusted network unless a TLS reverse
  proxy and `MC_ALLOWED_HOSTS` are configured"; "Treat agent messages, skill packages,
  webhooks, and MCP content as untrusted input"; "alpha status still applies" to access controls.

## 5. Persistence

- SQLite, single file under `.data/`, configurable via `MISSION_CONTROL_DATA_DIR` / `--data-dir`.
- Docker: named volume `mc-data` mounted at `/app/.data`.
- tmpfs on `/tmp` and `/app/.next/cache` (ephemeral, not state).
- Backup is therefore a file copy of the data dir — favourable for the durability test.

## 6. Integration surface — relevant to Baton

**Verified present:** REST/OpenAPI API (`openapi.json`; live instance serves `/docs` and
`/api/docs`), CLI (pnpm commands), MCP server, WebSocket + SSE, webhooks.
This is a genuinely rich integration surface — Baton would not be reduced to DB-poking or UI clicking.

Known endpoints: `POST /api/tasks` (title, description, priority, optional assigned_to),
`POST /api/tasks/queue` (atomic claim of highest-priority task for an agent),
`POST /api/agents/register`.

Adapters shipped: OpenClaw, Claude Code, Codex, CrewAI, LangGraph, AutoGen, Claude SDK.

## 7. Lifecycle model vs. the brief's requirement

Documented status enum: `inbox`, `assigned`, `in_progress`, `review`, `done`, `rejected`,
`failed`, `cancelled`.

Mapping to the brief's required lifecycle:

| Brief state | Mission Control | Gap |
|---|---|---|
| INTAKE / QUEUED | `inbox` | merged |
| PLANNED | — | no state |
| WAITING_FOR_CONTEXT / RESEARCH | — | no state |
| ASSIGNED | `assigned` | ok |
| RUNNING | `in_progress` | ok |
| BLOCKED | — | no state |
| RETRY_SCHEDULED | partial — Aegis reverts `review`→`assigned`, max 3 cycles | indirect |
| WAITING_FOR_APPROVAL | `review` | ok |
| REVIEW | `review` | merged with approval |
| COMPLETE / FAILED / CANCELLED | `done` / `failed` / `cancelled` (+ `rejected`) | ok |

Approval gating exists and is real: **Aegis**, MC's built-in quality gate. Tasks at `review`
go to an Aegis agent; `VERDICT: APPROVED` → `done`, `VERDICT: REJECTED` → back to `assigned`
with a feedback comment; 3 cycles max then `failed`. Records land in a `quality_reviews` table.

## 8. Gaps against the brief — the important part

Four of the brief's mandatory work-item fields are **not documented in orchestration.md**:

1. **Parent/child tasks** — no hierarchical relationship documented. Multi-agent flows use
   sequential handoff via separate task creation, not nesting.
2. **Artifacts / evidence attachment** — no file upload or artifact linkage documented.
3. ~~**Heartbeat / run history**~~ — **RETRACTED 2026-09-05.** Heartbeats DO exist:
   `POST /api/agents/{id}/heartbeat`, sent every 30s (docs/quickstart.md). Stale-task
   recovery after 10+ min in `in_progress` is the backstop, not the mechanism.
4. ~~**Cost / token / spend tracking**~~ — **RETRACTED 2026-09-05.** Token usage IS tracked:
   `.env.example` defines `MISSION_CONTROL_TOKENS_PATH=.data/mission-control-tokens.json`
   and `MC_RETAIN_TOKEN_USAGE_DAYS=90`.

**Confidence caveat, stated plainly:** absence from one doc is not proof of absence from the
product. The README's feature list contradicts item 4. All four MUST be re-tested against
`openapi.json` on a running instance before being recorded as real gaps in the evaluation.
If they hold, scenarios 1–3 cannot be executed as written without custom glue, because all
three depend on parent/child decomposition and artifact links.

## 9. Site-specific conflicts (Tolowa fleet)

- **OpenClaw collision.** MC's flagship adapter and its auto-dispatch path (Pattern 3) run
  through the OpenClaw gateway (default port 18789). OpenClaw was fully deprecated on
  Wenatchee on 2026-08-23 with a standing rule that it must not be revived as a parallel
  control plane. Mitigation: MC is viable REST-only (Patterns 1–2, agents poll
  `/api/tasks/queue`); install with `--skip-openclaw`. Auto-dispatch is forfeited.
- **Existing harness.** Wenatchee already runs OpenMausBot on loopback :18795 with 16 bots.
  MC would be a second control plane on the same host.
- **Existing work ledger.** Motion Control / BATON already holds D1 `work_items` plus run
  receipts. MC overlaps this. The final recommendation must address overlap, not ignore it.

## 10. Open questions to resolve during install

1. Exact commit SHA + release tag at clone time.
2. Does `openapi.json` expose subtasks, artifacts, heartbeats, cost? (decides scenario feasibility)
3. Can an agent exist as an inactive placeholder, or must it poll to stay registered?
   (decides whether the 8 Desk worker roles can be modelled at all)
4. Real disk footprint of node_modules + `.next` build on arm64.
5. Does first-run setup work with no external auth provider configured (no Google)?
