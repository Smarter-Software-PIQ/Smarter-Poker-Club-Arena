# Smarter.Poker Reliability Controller: Project Checklist

Owner assignment: Dan, November 9, 2026 (handoff "Smarter.Poker Reliability
Controller", sections 1 to 16). One accountable owner: the Claude session that
opened this file. This is the single durable checkpoint for the build; another
session resumes from here and does not restart.

Status words used below are exact: `audited`, `designed`, `implemented`,
`tested`, `merged`, `installed`, `deployed`, `verified live`. Nothing is
claimed beyond the word used.

## 0. Authority And Policy Reading

- Task-specific owner instruction: build a permanent, server-side, non-AI
  controller with scheduled operation, recovery runbooks and Messenger
  escalation. That explicit instruction is the authorization
  `docs/agent-policy/HARDENING.md` requires for new scheduled functionality.
  It does not relax the rest of that standard: a runbook restores service, it
  never counts as the fix, and recurrence stays visible and escalates.
- Out of scope and still prohibited: anything that initiates, advances,
  retries or certifies a release; tournament start holds; arbitrary financial
  corrections; new paid services; runtime LLM calls.
- Read 2026-11-09 23:50Z from portable sources at main `cc652c44ca57`:
  `OWNER-POLICY.md`, `OPERATING-LAW.md`, `HARDENING.md`, `REFERENCE-INDEX.md`
  (policy 2.9). Canonical Mac copies and the "current owner handoff" section of
  `/Users/smarter.poker/Documents/AGENTS.md` were NOT readable: see blocker B1.

## 1. Stage A Findings (audited 2026-11-09, read-only)

### 1.1 Why The Alerts Reach An Unread Mailbox

`infra/monitoring/alertmanager.yml` (Hetzner, published by
`deploy-monitoring.yml`):

- Top-level receiver and the `severity="critical"` route are `email-critical`;
  `severity="warning"` is `email-warning`. Both send to `admin@smarter.poker`
  from `alerts@alerts.smarter.poker` through Resend. Critical repeats hourly.
- The `codex-inbox` and legacy `pager-sms` receivers post every non-canary
  alert to World Hub `/api/internal/alertmanager-page`, which commits it to
  `public.operational_alert_events`. Those routes use `continue: true`, so the
  email routes still fire afterwards. Tournament, MTT and Spin alerts stop at
  the inbox and send no email.
- So email is the secondary channel by design. The primary channel is a
  database inbox whose only consumer is an AI chat task
  (`01a09b86-5ba8-7290-8657-1041f13dd3ca`), woken by
  `smarter_private.ca_native_alert_signal` over Realtime.

Measured state of that primary channel (PokerIQ-Production, 23:50Z):

| Fact                                                     | Value             |
| -------------------------------------------------------- | ----------------- |
| `operational_alert_events` rows since 2026-09-13         | 336,323           |
| Rows still `firing` with `investigation_status = 'new'`  | 8,081             |
| Rows touched in the last 24 hours / distinct alert names | 3,111 / 102       |
| `ca_native_alert_deliveries` rows / never read           | 80,709 / 54,582   |
| Last time any delivery was read                          | 2026-11-07 03:37Z |
| Open `financial_alerts` / open critical                  | 61 / 29           |
| Open `ca_drift_incidents`                                | 5                 |

Conclusion: intake is durable and working. Nothing deterministic stands
between the inbox and a person. The consumer is a chat session that has read
nothing for about 68 hours, there is no programmed triage, no recovery, and no
message to the owner. `docs/runbooks/operational-alert-intake.md` already
records that chat activation "is not installed or proved".

### 1.2 Reusable Components

| Need                                      | Existing component                                                                                                                                                                                    | Reuse                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Authenticated structured intake           | Alertmanager webhook to World Hub to `fn_record_operational_alert(s)`; unique `(source,event_key)`; `delivery_count`                                                                                  | Yes, as the single intake. No email parsing.                      |
| Other producers already in the same inbox | `financial-alerts-*`, `drift-incidents-*`, `ca-stall-watch`, `engine-cutover-watch`, `club-arena.post-deploy-e2e`, `production-integrity-audit`, `mac-studio-git-maintenance`                         | Yes                                                               |
| Money incidents                           | `ca_drift_incidents`, `ca_incident_events` (append only), `fn_ca_incident_notify`, `ca_incident_notify_ledger`, `v_ca_alert_board`                                                                    | Read and link; do not duplicate or rewrite                        |
| Owner identity                            | `ca_incident_recipients`: one active platform recipient, user `47965354-0e56-43ef-931c-ddaab82af765`, profile `kingfish`, "Dan Bekavac", sign-in on the bekavactrading.com account he named           | Authoritative recipient source                                    |
| System sender                             | profile `00000000-0000-0000-0000-000000000001`, username `smarter.poker`                                                                                                                              | Candidate sender; confirm it can hold a conversation              |
| Idempotent Messenger send                 | `fn_send_message_once(conversation, sender, request_id, content, type, metadata)` with `messenger_send_requests` receipt; `system` type allowed; 2,000 character cap                                  | Yes                                                               |
| Push                                      | `push_outbox`, `claim_push_outbox_batch`, `requeue_stuck_push_outbox`, `fn_raise_notification`                                                                                                        | Yes, delivery states limited to what these prove                  |
| Engine health                             | `https://engine.smarter.poker/health` (public JSON)                                                                                                                                                   | Verification input                                                |
| Existing actors that restart or repair    | `sp-autoheal` (Docker health), Docker restart policy, `ca-table-stall-watch-10s`, `ca-crash-settle-abandoned-minute`, `ca-incident-escalation-tick`, `ca-resolve-*` crons, engine release transaction | Ownership map required before any controller mutation (section 4) |

Scheduler convention in this database is `pg_cron` (about 150 jobs), with
advisory-lock overlap guards and `statement_timeout` budgets.

### 1.3 Screenshot Alerts: What Is And Is Not Known

Engine serving at 23:50Z: release `391f7bc0d57c`, uptime 145,518 s, status ok,
no stalled tables.

| Alert                                                                                | Rule                                                                | Evidence now                                                                                                                                                                                                                                                                                     | Unknown                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HorseDecisionFallbacks (critical, firing since 19:48Z, 91.2/min in the 21:59Z email) | `sum(rate(poker_horse_decision_fallbacks_total[10m]))*60 > 5`       | Health: decision worker `expiredJobs 0`, `queueDepth 0`, `recoverableRequestErrors 0`, 8 shards ready, over the whole uptime. The counter increments in `ServerTableEngineTurns.ts` on ANY rejection of `decideFast`, not only expiry, after `reportError(..., 'horse_decision_worker_failed')`. | The rejection class. The alert text blames expiry; the worker's own counters say expiry is not it. Needs engine logs or Prometheus (blocker B2). Do not restart the worker on this evidence. |
| HorseBrainOutsideDomainSurge (warning) PLO4 40.81%, PLO6 40.28%                      | outside-domain share over 1 h above 40% with at least 300 decisions | 91 prior firing episodes since 2026-10-22                                                                                                                                                                                                                                                        | Whether the domain moved or coverage is missing per variant. Not repairable by widening domains.                                                                                             |
| ClusterPassErrors (warning) 6,480 in 15 min                                          | `increase(poker_cluster_pass_errors_total[15m]) >= 10`              | Firing row since 19:49Z                                                                                                                                                                                                                                                                          | Which game id fails each pass                                                                                                                                                                |
| HorseFleetThroughputRelativeDrop (critical)                                          | not yet read                                                        | 46 resolved episodes since 2026-10-27; last resolved 22:56Z                                                                                                                                                                                                                                      | Cause                                                                                                                                                                                        |
| MoneyAlertsGoingUnread                                                               | not yet read                                                        | 29 open critical `financial_alerts` now                                                                                                                                                                                                                                                          | Definitions per source                                                                                                                                                                       |
| StatsAllInEquityCoverageLow (warning)                                                | not yet read                                                        | Firing since 19:41Z                                                                                                                                                                                                                                                                              | Cause                                                                                                                                                                                        |

Separate live observations, not from the screenshots: health reports
`settlementStatus blocked` with 5 blocked settlements (oldest 65 s),
`tournamentResumesFailing 1`, and `cashNextHandStart` p95 24.1 s against the
2,000 ms limit. The two-second next-hand requirement is therefore NOT met in
production at the time of reading. Recorded as its own incident lead.

## 2. Architecture Decision (designed, not implemented)

Postgres-native controller in PokerIQ-Production, schema `reliability`,
because intake, incident history, Messenger and push already live there and it
keeps running with every chat closed and the Mac off.

1. Intake: an `AFTER INSERT OR UPDATE` trigger on
   `operational_alert_events` writes one `reliability.observations` row per
   delivery and upserts `reliability.incidents` by a stable fingerprint
   (producer class, alert name, scope labels). Unknown alert names create an
   incident with class `unclassified` and enter escalation. Informational and
   test rows, and repository notifications, never create incidents.
2. State machine: `investigating`, `recovering`, `verifying`, `recovered`,
   `contained`, `escalated`, `closed`. Transitions are a single SQL function
   with a transition table; illegal moves raise. Notification state is a
   separate table.
3. Tick: one `pg_cron` job with an advisory lock evaluates only time-based
   rules (attempt budget spent, verification window, reminder due, intake
   silent). It reads current state before acting; a stale alert cannot trigger
   a repair.
4. Messenger outbox: `reliability.notifications` rows are created in the same
   transaction as the transition that caused them. Delivery calls
   `fn_send_message_once` with `request_id = uuid_v5(incident, sequence)`, so a
   lost acknowledgment replays the same message instead of duplicating it.
   Recorded states: `queued`, `persisted_in_messenger`, `push_sent`, `read`,
   each only when the backend proves it.
5. Recovery catalog: `reliability.runbooks` rows (versioned, enable flag,
   limits) bound to compiled procedures. Engine-side actions go through narrow
   authenticated engine endpoints still to be audited; none exist in this
   design until section 4 is complete. Global `mutation_paused` switch leaves
   observation and escalation running.
6. Independent check: an Alertmanager rule on a controller heartbeat metric,
   so the controller and the thing that watches it do not share one failure.
   Messenger and the controller share the database; that shared dependency is
   a stated limitation, with email retained as the emergency path.

Email is NOT switched off by this project until Stage B is verified live.

## 3. Sequence And Acceptance Gates

- [x] A1 Repository, routing, intake and Messenger audit (this file)
- [ ] A2 Read `AGENTS.md` owner handoff on the Mac (still unreachable;
      portable policies 2.9 read from `docs/agent-policy/`)
- [x] A3 Inventory of the 164 loaded rules and 14 days of the inbox:
      `SOURCE-INVENTORY.md` (database-source classes inferred from names,
      provisional until observation mode confirms them)
- [x] A4 `RECOVERY-OWNERSHIP-MAP.md` (seven cron function bodies unread,
      marked there). Result: the controller never restarts the engine, never
      closes `financial_alerts` or `ca_drift_incidents`, and no narrow engine
      recovery endpoint exists yet, so Stage B is detect, group, escalate
- [~] B1 `implemented` and `tested` locally, NOT merged or installed:
  `supabase/migrations/20261110000020_reliability_controller_stage_b.sql`,
  `scripts/ci/test-reliability-controller-stage-b.py` (24 of 24 behaviours
  on PostgreSQL 17.11 via embedded-postgres), fixture and path-scoped
  workflow. Not run: vitest law tests and prettier (no `node_modules`).
  Installs with `notify_mode = 'observe'` and `mutation_paused = true`. Gate: native PostgreSQL test proves duplicate, redelivered,
  out-of-order, late-resolved, malformed and unknown alerts
- [ ] B2 Messenger escalation with the fixed "AI AGENT NEEDED" template,
      "Open Incident" and "Copy Agent Handoff". Gate: one real incident
      produces exactly one DM to the verified owner account; a replayed send
      produces none
- [ ] B3 Observation mode live for a measured window; classifications
      reviewed against the inbox
- [ ] C1 Horse decision delivery trail and the first runbooks, only after B2
      (blocker) is resolved and the rejection class is known
- [ ] D Event, job, release and integrity classes; many remain
      detect, contain, escalate, with the reason recorded per class
- [ ] E Hardening, protected release, production verification, operations
      documentation, final report

## 4. Open Blockers

- B1 Mac access. The session's request for `/Users/smarter.poker/Documents`
  was refused by the app's permission layer, so the canonical policies, the
  owner handoff section, the SSD worktree (`/Volumes/SmarterWork/agent-work`)
  and the local pre-push prechecks are unavailable. Work so far is from a
  cloud clone and read-only database access. Needed: the owner adds the
  Documents folder and the SSD work volume to this chat in the desktop app.
- B2 Engine evidence. Engine logs and Prometheus on Hetzner are not reachable
  from this session. Needed to name the `decideFast` rejection class and the
  failing cluster game. Reachable through the Mac once B1 is cleared.

## 5. Assumptions

- The owner's Messenger account is user `47965354...` (profile `kingfish`),
  taken from `ca_incident_recipients` and the sign-in he named, not from a
  display name.
- No production data, schedule, route or alert rule was changed in Stage A.

## 6. Delivery State (updated 2026-11-10 01:00Z)

Supersedes the earlier publication blocker: the repository was attached to the
owning session with push access at 00:16Z and the repo hooks run in the cloud
clone (`AGENT_CLONE_OK=1` for the disposable clone, approved commit identity,
locked `npm ci`). The Mac folders remain unconnected; nothing here depends on
them except engine logs (section 4, B2).

| Component                  | Branch / PR                                              | State                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage B database (this PR) | `feat/reliability-controller-stage-b`                    | implemented, tested (native 41/41 on PostgreSQL 17.11; 16 fixture objects hash-identical to production, 4 stand-in groups, see `FIXTURE-PARITY.md`); not merged, not installed |
| Fallback reason label      | `fix/horse-fallback-reason-label`, PR #10260             | implemented, tested (nine reasons driven); not merged; engine part needs an activation by the release owner                                                                    |
| World Hub controls         | World Hub `feat/reliability-incident-messenger-controls` | in progress                                                                                                                                                                    |
| Independent health signal  | `feat/reliability-controller-health-signal`              | in progress                                                                                                                                                                    |

Stage B design changes since section 2 was written:

- Sender is the established platform identity used by the bug-report route
  (`2d1cd6c3-...`), owner constrained by `fn_is_platform_alert_recipient`, one
  dedicated controller conversation; push through `push_outbox` event
  `reliability_escalation`, mirrored states only.
- Separate tables, tournaments, games, variants and clusters never merge.
  Wrapper rows join their inner alert only by the record id they carry.
  Escalations are digested per class and alert name to bound messages.
- A resolution binds to its producer episode. Unestablished order sets
  `resolution_state = 'uncertain'` and changes no status. Silence becomes
  `stale_unverified`, never `recovered`.
- `public.fn_reliability_incident_for_owner(uuid)` is the only non-service
  surface (owner only).
- Installs with `notify_mode = 'observe'` and `mutation_paused = true`. No
  runbook is enabled. Email routing is unchanged.

Remaining acceptance, in order: required checks, protected merge, migration
installed by `dispatch-merged-migrations.yml` and `apply-merged-migration.yml`
(refused :50 to :03 UTC), `@live-proof` readback, validation message and
replay, push dispatcher trace, observation window, health signal deployed,
`critical_only` enabled and one eligible real incident observed, World Hub
controls live, final report. Evidence is appended below as each lands.

## 7. Evidence Log

(append only: time UTC, what, identifier)
