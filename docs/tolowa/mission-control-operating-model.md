# Mission Control Operating Model for The Desk

**Status:** Architecture handoff for the Wenatchee POC and harness integration.

**Purpose:** Define how Builderz Mission Control is used in the Tolowa/Desk agentic harness without creating a competing work ledger, unsafe routing path, or fragmented operational truth.

## Decision Summary

Mission Control is an operator-facing runtime and workflow surface, not the authoritative execution engine for The Desk. It may provide a useful task/run/session UI, runtime inspection, health and spend views, review/approval interaction, and a future controlled command entry point.

The canonical operational substrate is **Baton plus the Railway/Postgres work ledger**. Baton is the network-callable work primitive, policy/routing layer, and receipt controller. The ledger owns durable work state and event history.

Mission Control must consume a one-way projection of canonical Baton/Postgres state, or query it through a tested adapter. A command initiated in Mission Control must be sent to Baton and create the same canonical work item, events, artifacts, and receipt as a command initiated through Grokbot, Claude Desktop, Cursor, Hermes, or another caller.

Do not adopt Mission Control's SQLite state as a ledger of record. Do not build bidirectional synchronization between Mission Control tasks and Baton/Postgres work items. That would create split-brain operations.

## Evidence Labels

Every architecture or implementation claim must be labeled in handoffs, plans, and receipts.

- **Verified live:** Reproduced in the Wenatchee environment, validated by runtime/API output, source inspection, or a test.
- **Verified external:** Confirmed by a current official vendor document, public source repository, release note, or formal standard.
- **Architecture decision:** An explicit harness choice informed by evidence.
- **Open validation:** A hypothesis or desired capability that is not safe to assume until it has a named test and recorded outcome.

Internal memories, agent narration, task status, and design documents are useful context but are not sufficient evidence on their own.

## Canonical Ownership

| Concern | Canonical owner | Mission Control role |
| --- | --- | --- |
| Work items, dependencies, lifecycle, events, receipts, checkpoints | Baton + Railway/Postgres | Read-only projection or tested view |
| Routing, retries, escalation, caller policy, budget controls | Baton | Display routing outcome; send future commands to Baton |
| Conversational intake and chief-of-staff coordination | Grokbot / Desk | Surface status and exceptions |
| Design, planning, judgment, skill-driven work | Claude Desktop / Claude Code | Surface assigned run and resulting evidence if projected |
| Repository, branch, pull request, CI truth | GitHub and build providers | Link to authoritative IDs and results |
| Persistent workers, routines, schedules | Hermes on Wenatchee, mediated through a tested A2A contract | Display projected health/events; do not masquerade as dispatcher |
| Project knowledge, specs, and decisions | Notion | Link to canonical pages/IDs |
| Durable recalled context | Stash | Link or retrieve scoped context; do not duplicate indiscriminately |
| Legal/domain matter data | Matter-specific MCP and database such as Neon | Respect access boundary; link approved references only |
| CRM, deployment, and infrastructure truth | Respective CRM, Railway, Cloud, Neon, Supabase, or provider system | Display linked operational evidence |
| Human review and business judgment | Jeramey or explicitly designated reviewer | Provide an optional review surface, never bypass required approval |

## Normal User Workflow

Jeramey should continue to work through the tools that already fit the work:

- **Grokbot / Desk:** Daily front door, chief-of-staff briefings, conversational intake, prioritization, and direct Cursor launch when that is the fastest human-in-the-loop path.
- **Claude Desktop:** High-context thinking, architecture, strategy, writing, design, and invocation of familiar skills.
- **Cursor / Codex:** Repository implementation and technical execution.
- **Hermes:** Persistent routines, recurring workers, scheduled operations, and durable background execution.
- **Mission Control:** Open when inspecting exceptions, reviewing runs, checking health/costs, prioritizing work visually, auditing evidence, or using a future controlled command interface. It is not the required starting point for work.

Fast, disposable questions remain in the active chat. A request is promoted into canonical Baton work when it has a durable deliverable, crosses agents or tools, persists beyond the current session, changes code/data/configuration/external systems, requires a schedule, has material cost or risk, needs evidence/auditability, or requires review/approval.

## Canonical Work Contract

Every consequential Baton work item must include at least:

- Caller identity and authenticated caller class
- Project or matter namespace
- Objective and capability class
- Owner/executor and any explicit collaborators
- Links to scoped canonical context
- Constraints, including security, data-access, tool, time, and budget limits
- Acceptance criteria and expected artifacts
- Verification plan
- Escalation rule and required approvals
- Requested lane and the ultimately executed harness

No consequential item is complete because an agent says it is complete. Completion requires durable evidence: an output/artifact pointer, relevant source or test result, a terminal receipt, and required human or quality approval.

## Baton: Canonical Work Primitive

Baton must be callable over the network by Grokbot/Desk, Claude, Codex, Cursor, Hermes, monitors, and approved future integrations. It must:

1. Authenticate each caller independently and record caller identity.
2. Enforce caller/project authorization, budgets, and policy.
3. Create or advance the canonical work item and event trail.
4. Select a capability and execution lane.
5. Prevent recursive/self-dispatch and quota self-contention.
6. Record `requested_lane` separately from `executed_harness`; never silently substitute a lane.
7. Persist model/work output and artifact pointers before a process can exit or a run reaches terminal state.
8. Emit durable progress, failure, monitor, and completion events.
9. Return a reviewable receipt to the initiating surface.

### Capability Classes

| Capability | Contract | Default implementation direction |
| --- | --- | --- |
| **THINK** | Bounded reasoning or analysis returning structured findings and a receipt | API-backed model lanes; not session-bound headless CLI dependency |
| **FIND** | Fresh, grounded external research returning sources, confidence, and structured findings | Vendor-neutral capability; Perplexity API is eligible, but the interface must permit alternatives such as Brave, Exa, Tavily, or search plus in-house synthesis |
| **BUILD** | Long-running repository work producing agent ID, branch/commit/PR/test evidence and terminal receipt | Asynchronous Cursor Cloud/API work with polling or webhook reconciliation |
| **HERMES** | Persistent job/routine execution with lifecycle and cancellation semantics | Only after a tested authenticated A2A job adapter exists |
| **SPECIALIZED** | Domain/project execution through a constrained integration | Legal MCP, CRM, deployment, database, browser, or other approved connector |

Capabilities are contracts, not vendor or model names. A caller asks for FIND, for example, rather than hardcoding a specific research vendor into every skill.

## Reliability and Routing Rules

- Do not make a core Baton lane depend on session/OAuth-authenticated subprocess CLIs for unattended or hosted execution. Use API-backed paths where possible.
- Run preflight before dispatch: capability available, credential/identity valid, budget clear, model/version configuration valid, and required token/output limits viable. Fail before spend and name the remedy.
- BUILD is asynchronous. Submission returns a durable work item and build-agent reference; reconciliation produces the terminal receipt. Never block a request waiting for a potentially hours-long repository job.
- Actual output is mandatory ledger data. Storing only timing, token counts, or metadata is a failed execution contract.
- Failed, stale, canceled, and blocked work must remain visible and recoverable; never silently abandon it.
- A user-visible agent identity must match the actual execution harness. If a fallback is allowed, record both identities, the reason, and the policy authorization.

## Hermes and Wenatchee

Wenatchee M2 Mini is the persistent host for the POC and long-running harness functions. Claude on Wenatchee is building and testing the Mission Control integration.

Mission Control must not be assumed to dispatch Hermes merely because it can show Hermes-related status/configuration data. Before Hermes becomes a Baton-callable execution lane, implement and test an explicit A2A job contract:

- Authenticated job acceptance
- Idempotency key and duplicate suppression
- Accepted acknowledgement
- Heartbeat and progress events
- Artifact/result publication
- Terminal success/failure/cancelled receipt
- Cancellation and safe pause
- Audit log and stale-job recovery

Baton calls this contract. Mission Control may project the resulting events and provide an operator UI.

Mission Control must remain loopback-bound on Wenatchee unless a deliberate, security-reviewed exposure design is implemented. Do not rely solely on application Host-header checks to protect a service listening on all interfaces.

## Monitor Policy

Spokane Wire, CRM/campaign systems, Defending Katrina/legal monitors, Grokbot chief-of-staff monitors, and future monitors are event producers. They should not produce a new operational task for every healthy heartbeat.

Publish canonical events for meaningful transitions only:

- Healthy to degraded
- Degraded to failed
- New actionable incident
- Threshold, deadline, budget, or policy breach
- Remediation attempted
- Remediation succeeded or failed
- Stale/no heartbeat condition
- Scheduled report or deliverable ready
- Human decision, approval, or missing input required

Baton classifies the event, applies severity/policy, and creates or advances a canonical incident/action work item. Mission Control displays the health state, incident, evidence, and resolution projection.

## Knowledge and Context Protocol

Use scoped context. Do not indiscriminately ingest broad project knowledge into every agent call.

Default retrieval order:

1. Stash for durable relevant memory and prior decisions
2. Canonical Notion router or known canonical page IDs
3. Only the project pages, databases, repositories, files, or external sources necessary for the current work item

Notion is the readable project/specification/decision home. Stash is durable retrieved context. Neither replaces the Baton/Postgres operational ledger.

## Defending Katrina / Legal Boundary

The Defending Katrina matter and related legal work require a distinct security and governance boundary:

- Least-privilege agent and connector access
- Minimum-needed context retrieval
- Matter-specific namespace and cost/budget attribution
- Strict source/evidence requirements
- Audit-grade receipts and artifact pointers
- Mandatory human review for sensitive, substantive, external, client-facing, legal, or otherwise consequential outputs
- No inference that a system may access the matter merely because it is aware the matter exists

Mission Control must only show or act on information permitted by this boundary.

## Mission Control Integration Boundary

### Keep and use

- Wenatchee POC/fork as an integration test bed
- Operator-facing task, session, runtime, review, health, and spend UI experiments
- Runtime capability contracts and adapter requirements discovered through source inspection and tests
- Loopback-only hosting and explicit hardening
- Evidence-based upstream patches and contribution opportunities

### Do not assign today

- Canonical work ledger authority
- Parent/child/dependency graph authority
- Bidirectional state synchronization with Baton/Postgres
- Unverified Hermes dispatch
- Silent runtime or lane substitution
- Sole authoritative artifact/receipt storage
- Public exposure based on default network binding

## Minimal Instructions for Harness Clients

Global instructions for Claude, Codex, Cursor, Grokbot, Hermes, and other clients should stay short. They should require the following:

1. Follow the current project/context protocol and retrieve only relevant scoped context.
2. For consequential work, invoke or create a canonical Baton work item before execution.
3. Treat the Baton work contract and linked canonical context as authoritative for that item.
4. Report genuine progress, artifacts, test/source evidence, blocked state, and completion receipts to Baton.
5. Do not claim completion without the required evidence and approval.
6. Do not create a competing task ledger or bypass Baton for tracked work.
7. Follow project/matter access, budget, and approval rules.

Put domain practice in skills: pitch decks, websites, campaign design, research, legal research, code review, and similar specialties. Put workflow policy in Baton. Put project truth in the correct system of record. Put the specific objective and acceptance criteria in the canonical work item.

## Immediate Implementation Sequence

1. Preserve the Mission Control POC and current tested patches; inspect the active working tree before modifying it.
2. Stabilize Baton v2 as an API-callable primitive with durable output/receipt persistence, preflight, caller identity, budget enforcement, and explicit lane truth.
3. Remove core dependence on unattended session-authenticated Claude/Cursor CLI subprocess lanes.
4. Reach and demonstrate the defined reliability threshold before expanding complexity.
5. Implement FIND as a vendor-neutral research capability with source and spend receipts.
6. Implement BUILD as asynchronous Cursor API/cloud submission plus reconciliation.
7. Define, implement, and test Hermes A2A before treating Hermes as a callable worker.
8. Define a one-way Baton/Postgres-to-Mission-Control projection or tested read adapter.
9. Add future Mission Control command actions only as Baton API clients, with canonical work records and approval policy.
10. Capture verified evidence, versions, test results, failures, and open validations in Stash and repository documentation.

## Acceptance Criteria

This operating model is implemented only when:

- A consequential request from Grokbot, Claude, Cursor, Hermes, or a monitor creates or advances one canonical Baton/Postgres work item.
- The work item can be linked to project context and authoritative artifacts without duplicating systems of record.
- A worker’s actual execution harness, output, evidence, cost, and terminal state are recoverable after the originating chat or SSH session ends.
- A failed/stale job is visible and recoverable rather than silently abandoned.
- Mission Control can show a faithful projection of selected canonical work/runs without becoming a competing authoritative ledger.
- Any Mission Control command travels through Baton and yields the same canonical record/receipt as other harness entry points.
- Hermes execution is not represented as successful or dispatched until its A2A adapter passes end-to-end tests.
- Legal/matter work remains constrained by explicit least-privilege, audit, and human-review controls.

## Final Principle

Use internal context to know what matters. Use current external and primary-source evidence to decide what is true. Use explicit tests in the actual harness to decide what is safe to build.
