# Tolowa Studio — Mission Control evaluation

This directory holds Tolowa Studio's evaluation of Mission Control as a durable
work-control layer, plus the patches that came out of it. It is additive to the
upstream project and is intended to stay out of upstream's way.

Fork of `builderz-labs/mission-control`, evaluated at commit `5483a0e`
(`v2.3.0-11-g5483a0e`, 2026-08-24). Deployed on a Mac mini M2, local install,
loopback only.

## Contents

| File | What it is |
|---|---|
| `discovery.md` | Pre-install research: license, maturity, prerequisites, auth and persistence model, and the gaps found by reading source before installing. Contains two findings later retracted by measurement — retractions are marked inline rather than deleted. |
| `install-plan.md` | The plan approved before anything was installed: exact commands, paths, ports, rollback, and risks. |
| `mc-capability-contract.md` | API-level capability extraction from `openapi.json`. **Read the caveat**: `openapi.json` declares 1.3.0 while `package.json` is 2.3.0. The spec is stale and understates the product. `src/lib/validation.ts` and the live SQLite schema are authoritative. |

## Patches on this branch

1. **stream-json result extraction.** The CLI returns a JSON *array* of stream
   events. `JSON.parse` succeeds, `parsed.result` is undefined because an array
   has no such property, and the code fell through to storing the entire raw
   stdout — then truncated the *head*, discarding the answer at the tail. Tasks
   were marked `outcome=success` with zero work product, and the stream's `usage`
   field was discarded too, so token accounting silently received nothing.
2. **Hermes dispatch over A2A.** Upstream declares
   `dispatch: false, // no dispatcher branch` for the Hermes runtime. Hermes
   exposes an A2A JSON-RPC server (`message/send`, `tasks/get`, `tasks/cancel`)
   with first-class artifacts. `src/lib/hermes-a2a.ts` dispatches through it.

## Defects found and not yet patched

- `package.json`'s `start` script binds `0.0.0.0` while `dev` binds `127.0.0.1`;
  `scripts/start-standalone.sh` also defaults `HOSTNAME` to `0.0.0.0`. The
  `MC_ALLOWED_HOSTS` check in front of it is an application-layer Host header
  test and is bypassed by `curl -H "Host: localhost"`.
- Integration `status: "connected"` means only that env vars are non-empty; it
  never validates. A dead credential displays as connected. A working validator
  already exists at `POST /api/integrations` with `action: "test"`.
- `classifyDirectModel` escalates to Opus when a task description exceeds 2000
  characters, and ignores the agent's configured model entirely.
- The 180s CLI timeout abandons the child process rather than killing it, so
  work continues and spend accrues against a task shown as failed.
