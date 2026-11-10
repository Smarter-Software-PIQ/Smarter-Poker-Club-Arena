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

Postgres-native controller in PokerIQ-Production, schema `smarter_private` (objects prefixed `reliability_`),
because intake, incident history, Messenger and push already live there and it
keeps running with every chat closed and the Mac off.

1. Intake: an `AFTER INSERT OR UPDATE` trigger on
   `operational_alert_events` writes one `smarter_private.reliability_observations` row per
   delivery and upserts `smarter_private.reliability_incidents` by a stable fingerprint
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
4. Messenger outbox: `smarter_private.reliability_notifications` rows are created in the same
   transaction as the transition that caused them. Delivery calls
   `fn_send_message_once` with `request_id = uuid_v5(incident, sequence)`, so a
   lost acknowledgment replays the same message instead of duplicating it.
   Recorded states: `queued`, `persisted_in_messenger`, `push_sent`, `read`,
   each only when the backend proves it.
5. Recovery catalog: `smarter_private.reliability_runbooks` rows (versioned, enable flag,
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

- B1 Mac access. CLEARED 2026-11-10 22:30Z, without the folder grant. The
  Cowork folder request for `/Users/smarter.poker/Documents` is still refused
  by the app's permission layer and was not retried or worked around. The
  route that does work is the local `counselors` MCP server's host terminal
  (tool `counselors__host_terminal`): raw bash on this Mac as the owner's
  account, working directory defaulting to the canonical checkout, with the
  GitHub CLI already authenticated. No credential is read, printed or copied
  to use it, and the Supabase service role is deliberately NOT in that
  shell's environment, so database checks still go through their workflow's
  identity as CLAUDE.md requires. Two practical limits: the bridge hard-caps
  every call at about 80 seconds, so anything longer (a pre-push hook, an
  `npm ci`, a native test) must be started with `nohup` and polled from a log
  file; and `scripts/new-migration.mjs` does not complete through it, while
  `scripts/reserve-migration-version.sh` does, so a reserved version needs
  its name length checked by hand against the 60-character ledger limit.
  With this route the canonical policies, the owner handoff section, the
  verified SSD2 worktree and the full local pre-push prechecks are all
  reachable, and all four were used for the 2026-11-10 incident batch in
  section 8.
- B2 Engine evidence. Engine logs and Prometheus on Hetzner are not reachable
  from this session. Needed to name the `decideFast` rejection class and the
  failing cluster game. Reachable through the Mac once B1 is cleared.

## 5. Assumptions

- The owner's Messenger account is user `47965354...` (profile `kingfish`),
  taken from `ca_incident_recipients` and the sign-in he named, not from a
  display name.
- No production data, schedule, route or alert rule was changed in Stage A.

## 6. Delivery State (updated 2026-11-10 07:30Z)

Supersedes the earlier publication blocker: the repository was attached to the
owning session with push access at 00:16Z and the repo hooks run in the cloud
clone (`AGENT_CLONE_OK=1` for the disposable clone, approved commit identity,
locked `npm ci`). The Mac folders remain unconnected; nothing here depends on
them except engine logs (section 4, B2).

| Component                 | Branch / PR                                              | State                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage B database          | `feat/reliability-controller-stage-b`, PR #10312         | merged as `f741b472e67511689dffdbead6616b3d00da18e6`; migration 20261110000020 installed; enabled in observe mode (`notify_mode = observe`, `mutation_paused = true`); verified live, see section 7 (07:23Z to 07:28Z) |
| Fallback reason label     | `fix/horse-fallback-reason-label`, PR #10260             | merged; the engine serving `bff6eed3` at 06:56Z does not contain it                                                                                                                                                    |
| World Hub controls        | World Hub `feat/reliability-incident-messenger-controls` | in progress                                                                                                                                                                                                            |
| Independent health signal | `feat/reliability-controller-health-signal`              | in progress                                                                                                                                                                                                            |

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

- 2026-11-10 01:10Z `EXTERNAL-PRODUCERS.md` added: 8 of 13 outside families
  traced, 5 remain unknown (OpenClawJobStale and `workers.deploy-error-poll`
  in the unconnected workers repo, the Mac-local Git Maintenance script, and
  two hand-written rows). Seed corrections it implies (InstallQueue to
  `development_notification`; the five unknown families to `unclassified`) are
  NOT in migration 20261110000020, whose bytes are the tested ones. They are
  the first item of the observation-window classification review and ship as
  a follow-up data migration.
- 2026-11-10 04:51Z PR #10260 (fallback reason label) squash-merged as
  `70fee8f20f92599c79edccce491cd35bdff12f84`; 37 checks passed, 0 failed on
  head `42e6118a`. Merged, not live: needs an engine activation by the release
  route. A comment on that PR from another workstream attributes the 04:27 to
  04:45Z fallbacks on engine `bff6eed3` to route_gate worker errors, with the
  fix in merged #10223; not verified by this project.
- 2026-11-10 05:10Z Stage B objects live in `smarter_private` with prefix
  `reliability_` (the repository's `check-migrations-applied` allows only
  `public` and `smarter_private`); browser roles are revoked per object.
  Native test 41/41 after the move. Local pre-push gate passed at `7bde6e6d7`.
- 2026-11-10 07:23:50Z PR #10312 squash-merged as
  `f741b472e67511689dffdbead6616b3d00da18e6`; exact-head checks on `aff9a633`:
  50 passed; one non-required check red ("Installed and merged migrations
  agree": production migration 20261109040704
  kings_club_downline_reattach_snapshot has no file; not this project's).
- 07:24:20Z "Apply Merged Migration" run 42775056016 succeeded;
  `supabase_migrations.schema_migrations` holds 20261110000020; 50
  `reliability_` relations and 21 functions in `smarter_private`.
- 07:26:00Z first scheduled tick: job `reliability-controller-tick`, user
  `postgres` (not a superuser in production), status succeeded in 0.016 s,
  heartbeat written. This closes the superuser-fixture limitation for the
  tick.
- Installed state read back: `notify_mode = observe`, `mutation_paused =
true`, 0 enabled runbooks, triggers `zzz_reliability_intake_insert` and
  `zzz_reliability_intake_update` enabled, 0 reliability functions or
  relations reachable by anon or authenticated, owner function executable by
  authenticated only.
- Real intake observed within three minutes of installation: Alertmanager
  `DatabaseRepliesLost` became a warning incident;
  `LightningHandHost.post_commit_obligations_pending` for one table became a
  critical unclassified incident, escalated, and its notification was recorded
  `suppressed_observe` with no message sent. 0 intake rejections.
- 07:27:08Z validation message: notification 2 `persisted_in_messenger`,
  message `97efa73c-d55d-4de6-91a1-c15f75b2fc90`, conversation
  `5dde8c6a-7132-4983-953b-f4670742eb2d` between platform sender
  `2d1cd6c3-...` and owner `47965354-...`. Replaying `fn_send_message_once`
  with the same request id returned `replayed: true`; one message carries that
  request id.
- Push for that message: `push_outbox` row `04b51507-...`, event
  `reliability_escalation`, status `pending`, 0 attempts at 07:28Z. Pending
  proves neither dispatch nor phone delivery; dispatcher outcome still to be
  traced.
- Owner function at the database level (role authenticated with the caller's
  claims, rolled back): owner received the incident object; a non-owner and
  anon each received SQLSTATE 42501.
- Release coordination: the booking check that blocked every branch was
  corrected by its owner in #10317 (06:22Z). The applier itself holds installs
  while a Backup export runs (`backup-export-holds-installs.mjs`), which is
  what protects the release snapshot; this install went through that route.

## 8. Production Alert Batch, 2026-11-10 (by incident UUID)

Six critical incidents arrived as AI-AGENT-NEEDED handoffs. Status words are
the exact ones defined at the top of this file. Three of the six turned out to
be false pages whose cause was in the controller's own reading of the world,
not in the thing being reported, and one single defect (8.3) explains why
three recovered incidents still presented as needing an agent.

### 8.0 Owned cleanup that was blocking every merge

`Installed and merged migrations agree` was red on EVERY open pull request
(seen on #10385 and #10386), so nothing could be delivered. Cause:
`20261109040704 kings_club_downline_reattach_snapshot` had been applied to
production through the Supabase MCP and never committed, so SQL ran that main
had never seen. `merged` and `installed` and `verified live`: PR #10396,
squash `be5ca3b7`, 50 checks pass and 0 fail.

- Forward fix `20261110215108` installed. Readback: `anon`, `authenticated`
  and `PUBLIC` hold no privilege on `kings_club_downline_repair_20261108`;
  `service_role` holds exactly SELECT, INSERT, UPDATE, DELETE; RLS still
  enabled; all 10 snapshot rows preserved.
- The historical recording was NOT replayed. The applier REFUSED it with "does
  not open with BEGIN; and close with COMMIT;" and committed nothing, which is
  the correct outcome for already-applied SQL; production's statements for
  that version still hash to `93cad27fd8322c1025d8957fb8984caa`, equal to the
  committed file. The refusal does leave a red `apply-merged-migration` run on
  main for every recording merge, because the dispatcher has no skip for a
  manifest recording. Recorded here as a known characteristic, not fixed.

### 8.1 `9f5b0304-8634-48b9-a8ec-ea9c2fc563e4` MergedMigrationNotInstalled

False page. `fn_ca_merged_migration_install_watch` judged a whole-file property
from a diff hunk: commit `22c1fe09` carried `20261110173033_lightning_...` as
`renamed`, so GitHub returned a patch beginning `@@ -3,7 +3,7 @@` and line 1,
where `-- @install-window: daily-maintenance` lives, was absent.
`COALESCE(patch, raw)` preferred that fragment and `COALESCE(..., false)`
recorded it as ordinary-route, so a migration correctly queued for the 04:00
window was paged critical after 60 minutes.

Owned by another lane in PR #10386, which already read the raw file at the
merge SHA and set `v_unread` BEFORE recording the commit, so an unreadable file
cannot advance the cursor or strand later commits. That branch was continued,
not duplicated: its preimage pin `050181cc806cb87f389881b72e543330` was
verified still equal to the installed function, and the one open case was
closed. An empty body is now unreadable: GitHub can answer 200 with `''` and
`ca_migration_watch_raw` returns that rather than NULL, so blank text read as
"no window header". The test is `v_text !~ '[^[:space:]]'`, not `btrim()`,
because one-argument `btrim()` strips only spaces and a body of newlines and
tabs survived it. That was caught by the new regression case, not by review.
`implemented` and `tested`: two cases added to
`scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`, run locally
against throwaway PostgreSQL 17. Without the migration change they fail
(`state` reads `read`, the version is recorded, `raised=1`); with it the whole
suite reports `all passed`. Current main merged in; the branch had been 18
commits behind.

`merged` and `installed` and `verified live`: PR #10386, squash `b5320c9d`,
merged 2026-11-10 23:36:27Z, 51 checks pass and 0 fail; migration
`20261110194917` dispatched and installed by `apply-merged-migration` run
`42924853123` (success). Readback: the installed
`fn_ca_merged_migration_install_watch` carries BOTH
`WINDOW HEADER FROM THE WHOLE FILE (20261110194917)` and
`AN EMPTY BODY IS UNREADABLE (20261110194917)`.

Controller outcome: the source is fixed, so no future renamed or empty-bodied
window file is mis-routed. The one page the defect already raised
(`operational_alert_events` 376392) was still firing after the install,
because the mis-recorded `window_install = false` row for `20261110173033`
predates the fix and step 2 of the watch only resolves on installed-or-retired.
That row is corrected and the page withdrawn, with its evidence, by migration
`20261110233941` in the follow-up pull request; the migration itself still
waits for its 04:00 America/Chicago window, which is correct.

### 8.2 `61fc0986-d4dd-4b54-9c58-14b2605aecc0` fn_ca_cron_failure_watch, ca-collusion-daily

Real. Cron job 202 failed every day from 2026-11-07 with
`canceling statement due to statement timeout` at
`fn_ca_collusion_scan(integer) line 6`, against the function's own 120s.
`fn_ca_collusion_scan` drove from `public.profiles` with one lateral aggregate
per profile: 5,015 profiles, 5,198,530 transfer rows in the 7-day window, only
1,056 distinct winners, and the shape pinned to
`idx_ca_hand_transfers_winner`, so it could not use
`ca_hand_transfers_played_at_idx` added the same day by `20261110162314` for
this very scan.

`implemented` and `tested` read-only on production, `merged` pending: migration
`20261110224528`, PR #10406. Equivalence proved on a fixed dataset
(`played_at > '2026-11-09 22:00:00+00'`, both shapes): 85,357 = 85,357 directed
rows, `EXCEPT ALL` zero in both directions so duplicate multiplicity matches,
`sum(cnt)` 415,007 both, `sum(gross)` 705,462,952.76 both, 68 = 68 qualified
pairs with all three thresholds applied, `EXCEPT ALL` zero both ways again.
Performance on the real 7-day window 9.03 s against a 120 s cancellation.
`ca_detector_registry` holds the detector at `retired`, so this resumes the
`ca_collusion_signals` inserts missing since Nov 7 and raises no incident.

### 8.3 `38ae668f-352c-4ef3-80b8-d1f8931383fa` Tournament.atomic_finish_outcome_unknown

No money defect, and the one defect that explains three handoffs. Financial
alert `235060db` resolved itself at 18:44Z with proof on the row: tournament
`4b551d52` COMPLETED and committed exactly once, one terminal receipt settled
`2026-11-10 18:39:50.676782+00`, prize pool 386.00 conserved to the cent by its
payout rows, bounty pool 345.00, escrow closed at zero at the same instant. The
unknown-outcome guard did its job.

What was broken is propagation. `smarter_private.reliability_transition` wrote
`escalation_state` on the way INTO `escalated` and never cleared it, while
`closure_basis` and `resolution_state` in the same UPDATE both special-case the
terminal statuses. Escalation was a latch, so a recovered incident kept
`escalation_state='escalated'` and `escalation_reason='no eligible recovery'`
for ever, and `fn_reliability_incident_for_owner` kept presenting it as AI
AGENT NEEDED. There is no second path:
`fn_ca_alert_resolution_reaches_the_incident` propagates a resolved financial
alert to `public.ca_drift_incidents`, not to the controller.

`implemented`, `merged` pending: migration `20261110224707`, PR #10406. Cleared
on `recovered` and `closed` only. `verifying` must not clear it because
`verifying -> escalated` is a legal edge and verification can fail;
`stale_unverified` must not because that closure is explicitly unverified and
must never read as a verified one. `escalation_reason` is left as written and
`reliability_incident_events` keeps every transition, so no history is lost.
This also restores the designed recurrence path: `reliability_apply_signal`
chooses a recurrence's status with
`CASE WHEN i.escalation_state = 'escalated' THEN 'escalated' ELSE 'investigating' END`,
so with the latch a new signal on a recovered incident jumped back to escalated
with nothing measured.

Two incidents are reconciled through the supported `recovered -> closed` edge,
each gated on its own resolved financial alert and each a no-op if the incident
has since moved: this one on `235060db`, and 8.4 on `ea0ae17c`. The existing
terminal receipt is reused as the evidence it already is; no settlement is
replayed. `78afb154` is deliberately NOT reconciled and a postimage assertion
fails the install if it was cleared, because the Spin fault is still live.

### 8.4 `a974b740-b4d4-4c50-9b92-b4b89a1730da` LightningHandHost.post_commit_obligations_pending

False page, 27 occurrences and 3 recurrences in one day for table `ea34f32d`,
every one completed by its successor. `fn_post_commit_handoff_is_a_warning`
existed to stop exactly this, but matched only
`ServerTableEngine.post_commit_obligations_pending` with error
`f06_owner_changed`, so the Lightning host's identical designed handoff kept
`critical`.

A substring match would have been wrong. Over 7 days that one source raises six
distinct conditions: the designed handoff
`post-commit obligations refused (predecessor_pending)` 263 times, plus 124
statement timeouts, 8 `LIGHTNING_HAND_IN_PROGRESS` refusals, 3 and 2 and 1
`supabase_timeout` variants on the RPC, the predecessor lookup and the
predecessor scan. Those five are genuine failures or unknown outcomes and must
keep paging, so source and error are compared for EQUALITY, which also excludes
the `drift_incident:financial_alerts:...` mirror rows.

Recognising the words is not enough either. A handoff is downgraded only when a
durable successor demonstrably owns the work: the hand's row in
`hand_atomic_commits` must carry a persisted `post_commit_payload`, which is
precisely what the projection worker applies and precisely what
`fn_post_commit_stranded_watchdog` reads. No payload means nothing owns it and
the alert stays critical. The migration refuses to install if
`post-commit-stranded-watchdog-5m` is not active.

Watchdog delivery verified read-only: that job is `*/5 * * * *`, active, last
run 2026-11-10 21:55:00Z succeeded, and 0 envelopes are stranded past 10
minutes. Its own critical `financial_alerts` row reaches the controller through
`trg_ca_financial_alert_incident`. Trigger order on `financial_alerts` is
`a00_operational_source_intake`, `a2_post_commit_handoff_is_a_warning`,
`trg_ca_financial_alert_incident`,
`zz_ca_alert_resolution_reaches_the_incident`, so the reclassification lands
before the incident is created and the watchdog's row is untouched by it.
`implemented`, `merged` pending: migration `20261110224637`, PR #10406.

### 8.5 `a544b469-9226-4770-9f77-d5a77e085ea7` union_accounting_scheduler

Real, and the only one of the six with money not settled. The weekly close for
`2026-11-02 08:00Z` to `2026-11-09 08:00Z` (union
`fade0000-0000-0000-0000-000000000001`) will not certify. Two independent
causes, both traced, neither yet fixed.

Cause A, performance. The chunked close tick (job 272, 4-minute statement
budget) is exhausted inside `fn_union_pnl_evidence_report` at line 228, the
uncached `touched` CTE over `fn_union_pnl_touched_registrations`.
`fn_accounting_close_warm_stop()` only yields BETWEEN steps, so a single
statement that overruns aborts the attempt (sqlstate 57014) and keeps nothing,
which is why attempts climb without progress. The function already reads a
certificate for that step through
`smarter_private.inventory_basis_cache_read(..., 'pnl_touched', union, start, end)`
and that cache is keyed by range, so sub-range certification is the natural
bounded, resumable correction.

Cause B, data. A `pnl_flows_problem` certificate holds `bad = 10` of 353,520
flows, all `kind='unsupported'`. Traced: all ten are cancellation refunds of
satellite-won seats in one CANCELLED tournament `f4153d52`, each 200.00,
`prize_liability -> player_wallet`, total 2000.00, which does not net to zero.
Each has a valid `tournament_refund_entitlements` row; they fail the predicate
at `fn_union_pnl_original_flow_evidence` line 181 because
`fn_union_pnl_satellite_seat_owner` resolves the owning club only from a
wallet-funded `entry` receipt on the IMMEDIATE satellite. Of 85 satellite_seat
entitlements in that tournament 75 resolve, and the ten split cleanly:

- 8 chained satellite seats. The player was admitted by WINNING an upstream
  satellite (`tournament_players.is_satellite_qualifier`, `source_satellite_id`),
  so no wallet entry exists on the immediate one. One hop upstream each has
  exactly one `entry` receipt whose funding club EQUALS
  `refund_wallet_club_id`, and that upstream registration is not itself a
  qualifier, so the chain terminates in one hop. The owner is determinable from
  evidence; the classifier simply does not follow the hop.
- 2 departed funding club. A proper wallet entry resolves to KINGS CLUB
  `a41434bb`, but both players left that club on 2026-11-02, before the
  2026-11-07 refund, and the 200.00 was paid into The Felt Society
  `a0000000`. KINGS CLUB's wallet paid the satellite entry and another club's
  member wallet received the refund, so this is a real unattributed inter-club
  value movement, not a missing code path.

Every participant in that tournament tree is `is_bot=true`, so this is seeded
play. That bears on urgency, not on whether the book certifies.

State: `audited`. The 8-row group is fixable from evidence. The 2-row group
needs an owner decision on which club's P&L bears it, and must not be guessed.

### 8.6 `78afb154-54ae-4661-bf7d-e5e3c18a6eb3` SpinFleetProducingNothing

Real degradation, and deliberately left escalated. The alertmanager condition
(`poker_spin_seconds_since_last_start > 1800 and poker_spin_open_boards > 0`)
cleared, but at 2026-11-10 21:17Z there were 6 Spin starts in the previous hour
against the runbook's documented ~100/hour, 45 boards in REGISTERING, and
`v_spin_unfilled_waits` showed 9 boards at 1 live seat and 2 at 2, none at 3,
oldest wait 1h43m. By the runbook's own step-2 test that is seating and demand
distribution, not the start path and not a quiet room.

PR #10385 `a seat-first board climbs one rung at a time, from every lane`
merged as `a364cb39` during this batch. It is engine-side
(`server/src/GameServer.ts`), so it is not serving until an engine release
carries it, and its actual behaviour has not yet been read against this
symptom. State: `audited`, not attributed as the fix.
