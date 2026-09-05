# Mission Control on Wenatchee — exact plan

Date: 2026-09-05 · Target: `m2-mini` / M2-Mini, arm64, macOS 26.6.2, 100.67.55.81
Status: **awaiting approval. Nothing installed.**

---

## 0. What is actually on Wenatchee right now (verified today, not assumed)

| Check | Result |
|---|---|
| Node / pnpm | v22.23.2 / 11.22.0 — **meets MC's Node 22+ requirement as-is** |
| Disk | 40 GB free internal + 5.1 TB on GSPEED. (Your stored fleet memory says ~5 GB — **stale**) |
| Port 3000 | **free** |
| Hermes | running: gateway PID 48943 on `*:8642`, dashboard PID 12432 on `*:9119`, launchd jobs `ai.hermes.gateway`, `-ops-monitor`, `-legal-specialist`, `com.tolowa.hermes.dashboard/.idaho/-heartbeat` |
| OpenClaw | **not running.** Ports 18789 and 18795 both free |
| CLIs present | `claude`, `codex`, `cursor-agent`, `cursor`, `gcloud`, `op`, `jq` |
| gcloud | authenticated as jeramey.james@gmail.com; secret read from `tolowa-studio` confirmed working |
| Power | `sleep 0` on AC — host stays up, so the restart test is meaningful |

**No port collision with Hermes.** MC takes 3000; Hermes keeps 8642/9119. They do not touch.

---

## 1. What it will look like

```
Wenatchee (m2-mini, 100.67.55.81)
├── Hermes            *:8642 gateway   *:9119 dashboard      ← untouched
├── ollama            *:11434                                ← untouched
└── Mission Control   127.0.0.1:3000   ← NEW, loopback only
    └── ~/services/mission-control-poc/
        ├── .env          (chmod 600, git-ignored)
        ├── .env.example  (names only, no values)
        ├── .data/        SQLite state + tokens ledger + logs + pid
        ├── docs/         discovery, architecture, test-work-items, runbook, evaluation
        └── sandbox-repo/ disposable git repo for Scenario 2

Laptop → ssh -L 3000:127.0.0.1:3000 m2-mini → http://localhost:3000
```

Nothing listens on the tailnet. No Funnel, no reverse proxy, no public DNS, no router changes.

### Config that will be set

| Variable | Value | Why |
|---|---|---|
| `PORT` | `3000` | free, verified |
| `MC_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | shipped default, correct for us — leave it |
| `AUTH_USER` / `AUTH_PASS` | `admin` / generated 32-char | stored to GCP as `mission-control-poc-admin-password` so it survives the laptop |
| `API_KEY` / `AUTH_SECRET` | auto-generated on first run | MC does this itself |
| `MISSION_CONTROL_DATA_DIR` | `.data` | keeps backup = one directory copy |
| `NEXT_PUBLIC_GATEWAY_OPTIONAL` | `true` | standalone mode; no OpenClaw gateway |
| `MC_RETAIN_TOKEN_USAGE_DAYS` | `90` | keep the spend ledger for the evaluation |
| Google OAuth | **left empty** | no external identity provider for a POC |

### On model credentials — a nuance worth your attention

MC's `.env.example` exposes no `ANTHROPIC_API_KEY` or `DEEPINFRA_API_KEY`. Its runtime
adapters drive the **`claude` / `codex` / `cursor-agent` CLIs already installed and already
signed in on that box** — they carry their own subscription auth. So the likely correct answer
is that **no provider keys need to be injected at all**, which is strictly safer.

I will determine the real provider-config surface at first run. Keys get pulled from GCP Secret
Manager **only where MC actually consumes them**, using `printf` (never `echo` — trailing
newlines break strict validators). Candidates, in order: `motion-deepinfra-api-key` (DeepInfra,
you have full capacity), `motion-anthropic-api-key`. **Codex and Grok stay unwired** — you told
me both are out of tokens, and wiring a dead provider produces a false negative in the evaluation.

---

## 2. Exact commands

**Phase A — install (~20 min).** Clone first so the commit SHA is pinned and recorded, which
the brief requires and `install.sh`'s own clone would obscure.

```bash
ssh m2-mini
mkdir -p ~/services/mission-control-poc && cd ~/services/mission-control-poc
git clone https://github.com/builderz-labs/mission-control.git .
git rev-parse HEAD && git describe --tags --always      # ← recorded as the evaluated version
bash install.sh --local --skip-openclaw --port 3000
chmod 600 .env
```

`--skip-openclaw` is load-bearing: it suppresses the installer's OpenClaw fleet health check
and cleanup, honouring the 2026-08-23 deprecation. On macOS `install.sh` takes **no privileged
path** — the sudo/systemd branch is Linux-only. No sudo will be run.

**Phase B — resolve the two open capability questions (~15 min).**

```bash
curl -s localhost:3000/api/docs | jq '.paths | keys'
```

This settles the only real unknowns left: **parent/child tasks** and **artifact attachment**.
Everything else in your required work-item list is now confirmed present.

**Phase C — Desk workspace + agents (~20 min).** Register the 8 worker identities via
`POST /api/agents/register`, backed by real runtimes where one exists (`claude-planner` →
`claude` CLI; `cursor-mechanic` → `cursor-agent`) and honest placeholders where it does not
(`grok-desk`, `codex-reviewer` — both out of capacity; they will be **labelled as placeholders**,
not passed off as live).

**Phase D — durability (~10 min).** A user LaunchAgent at
`~/Library/LaunchAgents/com.tolowa.mission-control.plist`, `KeepAlive=true`, no sudo.
This is a long-running service, so KeepAlive is correct here — unlike the `launchctl submit`
one-shot trap recorded on 2026-08-25, which I will not use.

**Phase E — scenarios + restart test (~45 min).** The three scenarios, the interruption/resume
test, and the approval gate through Aegis.

**Total: ~2 hours of my time. Not 2–3 days.**

---

## 3. What the outcomes will be

**Confident (verified in source/docs):**
- MC running privately on loopback, reachable from your laptop over an SSH tunnel.
- Task lifecycle: `inbox → assigned → in_progress → review → done/rejected/failed/cancelled`.
- **A real approval gate.** Aegis: `review` → `VERDICT: APPROVED` → `done`, or `REJECTED` →
  back to `assigned` with feedback, 3 cycles max, recorded in `quality_reviews`.
- **Heartbeats** every 30s to `POST /api/agents/{id}/heartbeat` + stale-task recovery at 10 min.
- **Token/spend ledger** at `.data/mission-control-tokens.json`.
- **Durable state** across restart — SQLite on disk, backup is a directory copy.

**Genuinely uncertain, and the POC exists to answer it:**
- Parent/child work items and artifact links. Your three scenarios all depend on them. If
  absent, the honest verdict shifts toward fork/extend rather than adopt.

**The finding I did not expect:** `.env.example` pins `MC_HERMES_INSTALLER_SHA256` next to
`MC_OPENCLAW_INSTALLER_SHA256`, `MC_CLAUDE_CODE_VERSION` and `MC_CODEX_VERSION`. **Mission
Control already treats Hermes as a first-class managed runtime.** Combined with an MCP server
exposing "35+ tools for agents, tasks, sessions, memory," this is materially closer to your
"one thing that brings the harness together" theory than the README suggests.

---

## 4. What you do to test it (~15 minutes, all from the laptop)

```bash
ssh -L 3000:127.0.0.1:3000 m2-mini
```
then open `http://localhost:3000`. Five things to try, in order:

1. **Sign in** with the generated admin password. Confirms auth works and is not open.
2. **Look at the Desk POC board.** Ask yourself the guiding question directly against the
   screen: what work exists, who owns it, what is blocked, what is next?
3. **Approve or reject a task sitting in `review`.** This is the human-approval gate — the
   single most important thing to judge by feel, because it is where you personally sit.
4. **Kill it and watch it come back.** `ssh m2-mini 'pkill -f mission-control'`, wait, reload.
   State must survive. If it does not, that is a fail and I will report it as one.
5. **Check the token ledger** to see whether spend visibility is real or cosmetic.

Your verdict on #2 and #3 is the POC. The rest I can measure; those two are taste.

---

## 5. How this affects your harness

| System | Effect |
|---|---|
| **Hermes** | **None during the POC.** Different ports, different process tree, untouched. MC's Hermes adapter is *not* wired in this phase — that is the follow-on decision, not this one. |
| **OpenClaw** | Stays deprecated. `--skip-openclaw`, gateway unconfigured, `NEXT_PUBLIC_GATEWAY_OPTIONAL=true`. The 2026-08-23 rule holds. |
| **Motion Control / BATON** | **Overlap is the real strategic question.** BATON already holds D1 `work_items` + run receipts. MC would be a second work ledger. The POC deliberately does **not** write to BATON — no dual-write, no migration. The evaluation report will name the overlap and recommend which one owns work state. |
| **Stash / Notion** | Untouched. They stay the durable memory and the visible library. MC would own *run state*, not decisions or documents. |
| **Your two other sessions** | No conflict — nothing here touches the Baton v2 graph work or Tolowa strategy. If MC proves out, its MCP server is plausibly the concrete substrate that Baton v2 has been designing toward, and I will say so explicitly in the evaluation. |
| **Cost** | **$0/month.** Local compute on hardware you own. No load balancer, no static IP, no managed anything. Nothing bills. |

---

## 6. Risks, stated plainly

1. **Alpha software.** The repo says so itself. Schemas may break between releases. Mitigated by pinning the commit SHA and keeping it off anything production.
2. **Second control plane on a box that already runs one.** Hermes is live with ~25 processes. MC adds a Node service. 16 GB RAM is the constraint to watch; I will record memory footprint.
3. **Parent/child + artifacts may be missing.** Would force scenario adaptation. I will document the adaptation rather than quietly redefine your success criteria.
4. **Placeholder honesty.** Codex and Grok are out of capacity. They will be shown as placeholders. I will not let the board imply a live agent that cannot run.
5. **Not production.** Nothing here becomes load-bearing without a separate decision.

**Rollback, complete:**
```bash
launchctl unload ~/Library/LaunchAgents/com.tolowa.mission-control.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.tolowa.mission-control.plist
pkill -f mission-control
rm -rf ~/services/mission-control-poc
```
No system state, no sudo, no daemon, nothing outside those two paths.

---

## 7. What I am asking approval for

- Install to `~/services/mission-control-poc/` on Wenatchee, local mode, loopback 3000.
- Create **one** new GCP secret: `mission-control-poc-admin-password`.
- Read existing secrets **only if** first run shows MC actually consumes provider keys.
- Install **one** user LaunchAgent for the restart-durability test.
- Create a disposable local git repo for Scenario 2.

Not requested, not doing: sudo, public exposure, Tailscale Serve/Funnel, OpenClaw revival,
touching Hermes, writing to BATON/Notion/Twenty/Stash, or any billable resource.
