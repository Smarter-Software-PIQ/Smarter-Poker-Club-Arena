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

**B2 (2026-11-11, CLEARED 02:37Z):** `download.osgeo.org` was unreachable from
00:05Z, failing the fixture build and so the required `TypeScript Check`. The
CI/infrastructure owner had already repointed the pinned artifact to
`ftp.osuosl.org` in #10422; #10419 only needed its branch updated. Verified
byte-identical before relying on it. See 10.4.

**B3 (2026-11-11, open, release custody):** the Spin alert rules cannot deploy
until an engine release carries the metrics they read. `Deploy Monitoring`
refuses correctly; activation is the certified table break inside the owning
deploy workflow, and dispatch is the sole release custodian's. `3a63852a` is a
candidate, not a selected release: prequalification in progress, Backup queued,
`Dispatch The Exact Main SHA` skipped. Blocks `78afb154` closeout only.
See 11.4.

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

## 9. Delivery And Live Verification, 2026-11-11 (by incident UUID)

Section 8 is the audit record and is left as written. This section records what
was delivered, what is installed, what was read back from production, and the
controller outcome. Nothing here is marked resolved because a patch exists.

### 9.0 Two findings that changed the delivery, both mine to own

**A merged migration that is REFUSED is not delivered.** `20261110224528`,
`20261110224637`, `20261110235613` and `20261110235631` all merged and were all
refused by the applier with nothing committed. A merge is not an install, and a
PR that goes green says nothing about whether the applier accepted the file.
Every one of the six incidents below is reported against
`supabase_migrations.schema_migrations` and a live readback, never against a
merge.

**`-- SUPERSEDED BY` satisfies CI and does not satisfy production.**
`scripts/ci/check-migrations-applied.mjs` honours the first-line marker (it only
requires that the named version has a file in the tree).
`public.fn_ca_merged_migration_install_watch` does not read the marker at all:
section 2 of that function closes a row only when the version appears in
`supabase_migrations.schema_migrations` or when `retired_at` is set, and
`retired_at` is set only by a commit that shows the file `removed` or renamed
away. A marker alone therefore leaves a never-installed file doing two wrong
things forever - paging `MergedMigrationNotInstalled` every hour, and being
re-dispatched to an applier that correctly refuses it every time, because
`scripts/ci/apply-recorded-migration.mjs` will never run a file marked
SUPERSEDED. Both happened at 00:42-00:43Z. The correct action for a
never-installed superseded file is to retire it out of the active chain, as in
#10217, #10179, #10158 and #5885.

**The stale-pin guard is right.** `scripts/ci/migration-stale-pins.mjs` snapshots
every function in `public` and `smarter_private` before the migration, finds the
ones whose `md5(pg_get_functiondef(...))` changed, and refuses the transaction if
any changed function's OLD md5 still appears in any `pg_proc.prosrc`. There is no
`@stale-pin-ok` declaration anywhere in this tree and none was written here.

### 9.1 `9f5b0304-8634-48b9-a8ec-ea9c2fc563e4` MergedMigrationNotInstalled

- **Cause.** Two independent defects. (1) The watch read a renamed migration's
  window header from the commit patch, which for a rename carries only the
  changed hunk, so a `daily-maintenance` file was put on the ordinary route and
  paged falsely; an empty-but-200 body read as "no window header" for the same
  reason. (2) Four of this batch's own migrations merged and were refused, and a
  `SUPERSEDED` marker does not retire them from the watch (9.0).
- **Change.** `20261110194917` reads the whole file when the patch is not the
  whole file and treats a blank body as unreadable and retryable
  (`v_text !~ '[^[:space:]]'`, not `btrim(v_text) = ''`, which strips only
  spaces and let `'   \n\t\n'` through - caught by the test added with it).
  `20261110233941` withdrew the false page for `20261110173033`. #10430 retires
  `20261110224528` and `20261110224637`.
- **Tests.** `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`,
  two new cases: an empty or blank raw body is unreadable and retried, never read
  as an absent window header; an added file with an empty patch is read from its
  raw text, not judged on nothing.
- **PRs.** #10386, #10418, #10430.
- **Installed.** `20261110194917` and `20261110233941` both in
  `schema_migrations`.
- **Live.** `window_install` for `20261110173033` is `true`; alert 376392 is
  `resolved`; both in-body markers present.

### 9.2 `61fc0986-d4dd-4b54-9c58-14b2605aecc0` fn_ca_cron_failure_watch, ca-collusion-daily

- **Cause.** `fn_ca_collusion_scan(integer)` was cancelled at its own 120s
  `statement_timeout` on every run from 2026-11-07 (`cron.job_run_details`:
  2026-11-08, -09 and -10 all `failed` at exactly 2m00s,
  `canceling statement due to statement timeout`, `line 6 at FOR over SELECT
rows`). The driver ran one lateral aggregate per profile - 5,015 of them -
  while only 1,056 had a transfer in the window, and its shape was pinned to
  `idx_ca_hand_transfers_winner` so it could not use
  `ca_hand_transfers_played_at_idx`.
- **Change.** `20261110234905` groups the window once in a MATERIALIZED CTE and
  keeps the profile restriction as an EXISTS. Equivalence was proved on a fixed
  dataset in both `EXCEPT ALL` directions, on counts, sums and all three
  thresholds. The retired-detector check is untouched.
- **PRs.** #10418 (reissue of the refused `20261110224528`).
- **Installed.** `20261110234905` in `schema_migrations`; marker
  `READ THE WINDOW NOT EVERY PROFILE (20261110234905)` present; no
  `CROSS JOIN LATERAL` remains in the function.
- **Live, measured read-only 2026-11-11 00:50Z.** `EXPLAIN (ANALYZE)` of the
  installed shape over the same 7-day window: **Execution Time 7,940 ms** against
  the 120s timeout it was hitting, a ~15x margin, with
  `Index Scan using ca_hand_transfers_played_at_idx` and a single hash join to
  5,033 profiles (`Index Only Scan using profiles_pkey`). 449,508 directed pairs
  to 249,256 undirected to 3,318 over threshold.
- **Controller.** Still `escalated`. The job is `20 4 * * *`; the next real run
  at 04:20Z is the confirmation. The defect is demonstrably gone; the incident is
  NOT being closed ahead of that run.

### 9.3 `38ae668f-352c-4ef3-80b8-d1f8931383fa` Tournament.atomic_finish_outcome_unknown

- **Cause (controller).** `reliability_transition` latched `escalation_state` and
  never cleared it, so an incident that recovered still read `escalated`. That
  latch explains three of this batch's six handoffs.
- **Change.** `20261110224707` clears `escalation_state` to `none` on any
  transition to `recovered` or `closed`, and reconciles this incident to `closed`
  gated on evidence (`235060db` resolved).
- **Installed and live.** `closed / none`, reconcile event logged.

### 9.4 `a974b740-b4d4-4c50-9b92-b4b89a1730da` LightningHandHost.post_commit_obligations_pending

- **Cause.** A post-commit handoff with a durable successor was classified
  `unclassified` rather than a warning.
- **Change.** `20261110234927` matches source and error by exact equality and
  additionally requires a durable successor
  (`EXISTS (... hand_atomic_commits c WHERE c.hand_id = v_hand AND
c.post_commit_payload IS NOT NULL)`), and refuses to install if
  `post-commit-stranded-watchdog-5m` is not active. Plus the 9.3 latch fix.
- **PRs.** #10418 (reissue of the refused `20261110224637`).
- **Installed and live.** Marker `A DURABLE SUCCESSOR OWNS IT (20261110234927)`
  present; incident `closed / none`, reconcile event logged.

### 9.5 `a544b469-9226-4770-9f77-d5a77e085ea7` union_accounting_scheduler

- **Cause.** Both causes in 8.5, unchanged: A, the uncached `touched` CTE
  overruns the chunked tick's statement budget and keeps nothing; B, 8 chained
  satellite seats are unresolvable because the owner is read only from a wallet
  `entry` receipt on the immediate satellite.
- **Live symptom.** A flap, not a steady alarm:
  `escalated -> verifying` ("the alert resolved") then
  `verifying -> escalated` ("no eligible recovery") about every 65 minutes -
  19:49, 20:40, 20:54, 21:45, 21:59, 22:50, 23:04, 23:56, 00:09Z. The refire
  follows each resolve by ~13 minutes, which is the post-install test: no refire
  for one full cycle.
- **Change.** `20261110235613` (one hop upstream, non-recursive, taken only when
  `e.entries = 0`, accepted only when the upstream registration names no
  satellite) and `20261110235631` (3-hour `generate_series` sub-ranges through
  the existing range-keyed `inventory_basis_cache`, plus
  `union_pnl_inventory_touches_frame_is_observed CHECK (frame_observed_at =
observed_at) NOT VALID`). Certification is not weakened: the same certificate
  is written, per sub-range.
- **REFUSED, and why.** Merged in #10421 at 00:29:29Z; both refused at 00:30
  with nothing committed, `migration_left_a_stale_pin`. Both changed bodies that
  other installed functions pin by md5:
  `fn_union_pnl_satellite_seat_owner` (`58b6c79c…`) by
  `original_inventory_proof_sources_match()`, and
  `fn_union_pnl_evidence_report` (`80f29ec1…`) by both that list and
  `fn_accounting_union_earned_plan_advance` (`911c6c96…`). The pin graph was then
  read read-only end to end: the list itself (`866cccb1…`) is pinned by nothing,
  so the cascade terminates at four functions, and the catalog and
  public-`search_path` md5s are identical for all four, so there is no second
  spelling of any old md5 to clear.
- **Reissue.** #10428 carries both patches byte-exact - same preimage pins, same
  anchor-uniqueness checks, same 83-resolved/0-null/2-mismatch measurement, same
  NOT VALID CHECK - and in the same transaction moves the advance's report pin
  and the list's three entries, reading each new md5 back from the catalog after
  the patch rather than hardcoding it, following `20261107234051`. Before COMMIT
  it requires `original_inventory_proof_sources_match() IS TRUE` and that no old
  md5 of any of the four remains in any `prosrc`, so the file refuses itself on
  the same condition the applier would. #10428 also retires `20261110235613` and
  `20261110235631` out of the chain.
- **Open owner decision, deliberately not guessed.** The 2 departed-funding-club
  flows stay `unsupported`. KINGS CLUB `a41434bb` funded the satellite entry and
  The Felt Society `a0000000` received the 200.00 each. Which club's P&L bears it
  is the owner's call.

### 9.6 `78afb154-54ae-4661-bf7d-e5e3c18a6eb3` SpinFleetProducingNothing

- **Cause.** Ownership first, as section 8.6 found: the fleet was producing, and
  the alert could not tell a quiet room from a stalled one because it watched
  `poker_spin_open_boards` without asking whether a person was in a waiting seat.
  The threshold was not lowered.
- **Change.** #10419: `20261110233909` gives `v_spin_unfilled_waits` a column
  saying whether a human occupies the waiting seat; `infra/monitoring/spin-rules.yml`
  and `SpinMetrics.ts` read the ladder the alert watches;
  `aSpinAlertReadsTheLadderItWatches.law.test.ts` plus a `docs/laws.d/` entry bind
  it.
- **Controller.** `recovered / escalated`. It reached `recovered` at 20:42:00Z by
  `quiet_window_passed` ("the alert stayed resolved for 30 minutes") after
  `resolved_signal` at 20:11:27Z. The 9.3 latch fix clears `escalation_state` on a
  _transition_, and this incident had already recovered before that fix installed,
  so its latched `escalated` needs one honest forward transition to `closed` -
  which is owed only once the monitoring correction is actually serving.
  `20261110224707` deliberately asserts this incident was NOT cleared, and the
  install would have failed if it had been.
- **BLOCKED on an external outage, not on code.** #10419 cannot merge.
  `download.osgeo.org` (140.211.15.30:443) is unreachable - from the GitHub
  runners (`DeadlineExceeded ... dial tcp ... i/o timeout` building the fixture
  image at the checksum-pinned `postgis-3.3.7.tar.gz`, `operations/release/fixture/Dockerfile:150`)
  and independently from the owner's Mac (`curl` times out at 25s), from 00:05Z
  onward. `Native fixture prerequisites / native-smoke` is not itself a required
  check, but `.github/workflows/ci.yml` makes the required `TypeScript Check`
  `needs: fixture_native` deliberately, so that "a skipped native prerequisite"
  can never "masquerade as successful verification of affected source". That gate
  is correct and was not touched, worked around, or declared ok. #10419 merges
  when osgeo answers; a watcher reruns native-smoke automatically on the first
  200/206. If the host stays down, the only other route is for the release owner
  to cache or mirror that pinned tarball - a change to shared release
  infrastructure and to a supply-chain input, which is not mine to make
  unilaterally.

## 10. Corrections And Closeout Evidence, 2026-11-11 02:00-03:00Z

Section 9 overstated two things. Both are corrected here rather than edited
away, because the reasoning error is the useful part.

### 10.1 A resolution that precedes the install proves nothing

Section 9.5 offered "resolved 01:05:23, no refire" as evidence that
`20261111003802` fixed the union close. The install committed at **01:09:08Z**,
_after_ that resolution, so the resolution cannot be attributed to it. Alert
silence and a cleared escalation latch are controller state, not accounting
evidence, and 9.5 should not have leaned on them.

What does prove post-install behaviour, and is the standard this section holds
itself to:

1. **Generation stamping.** The install rolled
   `smarter_private.original_inventory_basis_generation()` to
   `original-inventory-245-v1:40a6ffb4b726a0de4a06b74637725012`. The
   `pnl_flows_problem` certificate written at **01:45:09Z carries exactly that
   generation**, a string that did not exist before 01:09:08, so that
   certificate was necessarily computed after the install. A generation is a
   better clock than a timestamp here because it is derived from the function
   bodies themselves.
2. **Durable sub-range progress.** 84 `pnl_flows_window` partials persisted
   between 01:09 and 02:13, advancing monotonically. The pre-fix behaviour was
   "attempts climb without progress" precisely because an overrunning statement
   kept nothing. Persisted windows are the fix's signature.

### 10.2 The two unsupported flows: the reader was wrong, not the data

Section 9.5 left these "pending an owner decision on which club's P&L bears
it". That framing was wrong. No decision was required, no chips moved, and no
club was assigned the cost.

The flows, read-only from production:

|                                       | flow A                                 | flow B                                 |
| ------------------------------------- | -------------------------------------- | -------------------------------------- |
| entitlement                           | `17548750-4a28-42ae-b43c-c0d356d302e2` | `e23baaa9-7a11-4d33-8746-809e64e1af83` |
| admission ledger (`source_ledger_id`) | `faa88ed0-8d7b-478c-9eb1-02ad1b92f9cc` | `22f9e706-0cc8-4f1b-bc1e-d4fee041f8a6` |
| refund credit ledger                  | `b9216e23-3580-4480-9265-c146f7f0b5aa` | `ca27f46a-914e-4d4d-9221-408a86ee314b` |
| registration                          | `064bbc60-b702-433e-af68-042cf38fed83` | `bd08af1c-f2b8-4289-8624-511d483a7c34` |
| satellite                             | `2b654457-f2ef-42c8-b72a-1c8dbc8885d5` | `cb0ae6ee-d114-4a4a-aaa1-311bde3a4bf3` |
| gross                                 | 200.00 = 180 prize + 0 bounty + 20 fee | same                                   |

Funding: KINGS CLUB `a41434bb` wallet-funded both satellites - flow A entry
30.00 (`5e425751`, 11-02 03:03:14Z) plus addon 30.00 (`b6df4eeb`, 11-02
04:24:46Z); flow B entry 30.00 (`e023c0b3`, 11-02 19:13:05Z). Payout: both
`prize_liability -> player_wallet`, 200.00, category `refund`, club The Felt
Society `a0000000`, at 11-07 20:40Z.

The governing rule was already in the reader and names this case directly:
**"SATELLITE REFUNDS FOLLOW THE ADMITTED CLUB (01a1c81a). The upstream entry
proves backing, not the club of an already won target seat... never infer
ownership from live membership."** The admitted registration's first
`union_pnl_inventory_events` row records `club_id` = The Felt Society, equal to
`refund_wallet_club_id`. Every condition of that branch was verified
independently: the award/settlement/payout/admission/registration chain counts
exactly 1 for both, a single refund tranche each with `amount_paid_before = 0`,
`amount_paid_now = 200.00` and 180/0/20 splits, and idempotency keys matching
`tourney:<target>:refund-entitlement:<entitlement>`.

So the apparent mismatch was the PNL reader demanding equality to the UPSTREAM
entry club. `20261111010427_a_satellite_seat_refund_follows_its_admitted_club.sql`
(not this lane's work; it states it "requires the earlier chained-seat/sub-range
source fix from PR10428") corrected the reader and rolled the generation to
`...b94061573b28c8c38005e86587e7f10e`, which is why the 01:45:09Z `bad = 2`
certificate was superseded rather than deleted.

**Outcome, certified 02:25:09Z under the live generation: `pnl_flows bad = 0`**,
the clean kind rather than `pnl_flows_problem`. The progression is 10 unsupported
-> 2 (chained satellite seats, PR10428) -> 0 (admitted-club reader). The stale
`bad = 2` certificate remains as history.

**The week is NOT terminally reconciled.** It now contains zero unsupported
items, but `accounting_close_report_receipts` for
`2026-11-02 08:00Z -> 2026-11-09 08:00Z` is still empty; the last week with a
report receipt is 10-26 -> 11-02, computed 11-10 15:43:10Z. Operational recovery
and financial reconciliation are not the same claim and are not reported as one.

A third correction: section 8.5 said both players "left that club on
2026-11-02, before the 2026-11-07 refund". Not supported. Both joined 04-09 and
their KINGS CLUB membership rows read `suspended` with `updated_at` 11-09
14:40Z, after the refund. The rule forbids reasoning from live membership in any
case, so the claim was both wrong and irrelevant.

### 10.3 The collusion schedule is UTC, established not assumed

`20 4 * * *` is not self-evidently UTC. Confirmed two independent ways:
`cron.timezone = GMT` and `TimeZone = UTC`, and the last five observed starts
were exactly `04:20:00Z` on 2026-11-06 through -10. Next run 2026-11-11
04:20:00Z. The retired-detector check in `fn_ca_collusion_scan` is untouched by
`20261110234905`; only the window-reading driver changed.

### 10.4 Spin: availability fixed upstream, and the deployment route is the gate

`download.osgeo.org` (140.211.15.30, OSU OSL) was unreachable from 00:05Z. The
existing CI/infrastructure owner had already repointed
`operations/release/fixture/Dockerfile:150` and its line-229 source catalog to
`https://ftp.osuosl.org/pub/osgeo/download/postgis/source/postgis-3.3.7.tar.gz`
in #10422 (merged 01:15:30Z) - same version, same pin. Verified independently
before relying on it: 17,782,849 bytes, sha256
`50724a0dde49adc253e59e024d8b18fef6be4e85341943c6d5e1e1b974e43fce`, identical to
the pin, from both `ftp.osuosl.org` and `ftp2.osuosl.org`. `postgis.net/stuff`
was rejected: it answers 200 but serves 17,786,630 bytes with a different hash.
No version changed, no different bytes accepted, no gate skipped, and nothing in
this lane edited release infrastructure.

#10419 was merely behind that commit; updating its branch was the whole fix.
native-smoke and the required TypeScript Check both passed and it merged
02:37:05Z all-green. `20261110233909` is installed and `v_spin_unfilled_waits`
now carries `human_seats`, `horse_seats`, `unresolved_seats`,
`oldest_human_seat_at`, `longest_human_wait`.

**Green CI and an installed migration do not resolve this incident.**
`Deploy Monitoring` refused at 02:39Z, correctly:

> RULES AHEAD OF THE ENGINE THAT IS RUNNING (2) - they cannot fire:
> `poker_spin_human_arrival_max_seconds`, `poker_spin_ladder_full_envelope_seconds`.
> The engine is running `840429a3`... THAT BUILD DOES NOT [emit them], so no event
> on the platform can produce a sample and the rule evaluates to an empty vector
> for ever. Prometheus reports it as health=ok, state=inactive, which is the same
> thing it reports for an alarm that is genuinely quiet.

A rule with no producer is indistinguishable from a quiet alarm, which is
`78afb154`'s exact failure mode, so shipping the rules first would have
reproduced the incident in a new place. Order is engine, then rules.
`auto-deploy-hetzner.yml` fires only on a `deploy-club-arena-engine`
`repository_dispatch` carrying a `ref_sha`; `stage-engine-release.yml` dispatches
it on Backup Engine completion, and `Tell The Release Owner An Owner Window Is
Ready` fired at 02:40:24Z. This lane did not initiate a release and did not
silence, delete or weaken a rule. `78afb154` stays `recovered / escalated` until
the rules are serving and the latch can clear on one honest forward transition.

## 11. Collusion Closeout And Two More Withdrawn Claims, 2026-11-11 04:20-05:10Z

### 11.1 `61fc0986-d4dd-4b54-9c58-14b2605aecc0` fn_ca_cron_failure_watch: CLOSED

The schedule was established before it was read, not inferred from the cron
expression: `cron.timezone = GMT`, `TimeZone = UTC`, and the five observed
starts 2026-11-06 through -10 were each exactly `04:20:00Z`. So `20 4 * * *`
is 04:20 UTC, 22:20 America/Chicago.

Observed through completion:

| run                  | status        | duration                      |
| -------------------- | ------------- | ----------------------------- |
| 2026-11-11 04:20:00Z | **succeeded** | **00:00:13.17**               |
| 2026-11-10 04:20:00Z | failed        | 00:02:00.05 statement timeout |
| 2026-11-09 04:20:00Z | failed        | 00:02:00.02 statement timeout |
| 2026-11-08 04:20:00Z | failed        | 00:02:00.45 statement timeout |

Expected signal writes, verified: 3,500 rows into `public.ca_collusion_signals`
with `window_days = 7`, `detail->>'since' = 2026-11-04T04:20:00` (exactly seven
days), `both_cert = 0`; the table went 371,010 -> 374,510.

The detector stayed retired and that is load-bearing, not incidental:
`ca_detector_registry` still reads `retired` for `fn_ca_collusion_scan`, and
**zero** incidents were opened in the run's wake despite 3,500 flagged pairs,
because `v_retired` short-circuits the `fn_ca_raise_drift_incident` loop. The
scan records and pages nothing. `20261110234905` changed only the
window-reading driver; the retirement check is untouched.

Controller recovery was supported and unforced: `resolved_signal -> verifying`
at 04:23:00Z, three minutes after the run, then
`quiet_window_passed -> recovered` at 04:54:00Z once `ca-cron-health-30m`
(`7,37 * * * *`) re-evaluated. `escalation_state` cleared to `none` by the
`20261110224707` latch fix on that forward transition.

One distinction worth keeping: an out-of-band invocation at 00:58:36Z had
already run the fixed function to completion (3,322 rows, `since`
2026-11-04T00:58:36) with no cron entry at that time. That proved the function,
not the schedule. `fn_ca_cron_failure_watch` keys on the JOB's run history, so
only the 04:20Z scheduled run could clear the incident.

### 11.2 Withdrawn: "zero human tournament seats in 24 hours"

Stated while narrowing the Spin claim. Wrong. There were **14 human seats in
24 hours** - 4 cash, bounty 4, freezeout 3, mystery_bounty 2,
progressive_bounty 1, most recent 03:11Z - and `table_seats` retains rows back
to 2026-07-24, so retention was not the cause. The query only counted seats on
tables belonging to TOURNAMENTS CREATED inside the window, which excluded cash
tables entirely and any tournament created earlier.

What survives is the narrow claim, and only that: **zero human seats on Spin
boards in 24 hours** (155 Spin boards, 268 horse seats, 0 human, 0 unresolved),
with Spin absent from the breakdown above. Separately the view's own predicate
identifies **5 live human seats** right now - cash 3, freezeout 1,
mystery_bounty 1 - against 878 horse seats and 0 unresolved anywhere, so human
identification is live-verified; just never on a Spin board.

### 11.3 Withdrawn: "the union close stopped"

Also wrong, and wrong twice over in how it was measured.

`accounting_close_partials` holds the chunked `*_window` rows. All three
post-fix stages had already COMPLETED - `pnl_flows_window`,
`pnl_linked_window` and `pnl_hands_window` each 84/84 windows through
11-09 08:00 - so the absence of new partials meant a finished stage, not a
stalled one. The certifying stage writes certificates, not partials.

And `smarter_private.inventory_basis_cache_write` certifies through
`fn_accounting_close_certify(kind, union, start, end, ...)`, keyed by the range
it certifies. A SUB-RANGE certificate therefore carries the sub-range's own
bounds, so every query filtered to `period_start = week_start AND period_end =
week_end` is blind to exactly the artifacts `20261110235631` was built to
write. Read correctly at 05:11Z:

    pnl_touched    17 certs   11-02 08:00 -> 11-04 11:00   4 written in 20 min
    pnl_boundary    2 certs   full week
    pnl_flows       1 cert    full week, bad = 0

All 20 on the live generation `...87e7f10e`, one generation throughout, and
`pnl_touched_problem = 0`. That is the sub-range certification working: 17 of
roughly 56 three-hour slices, then `pnl_clubs`, then the receipt.

Job 272 `union-weekly-rakeback-close` (`*/5 * * * *`) advances only at minutes
40-44, or on a continuation condition. The current run holds
`chunk_committed: true`, `stage: certifying`, `purpose: club_settlements`,
`pnl_evidence.status: blocked` / `union_pnl_certification_in_progress`, which is
what keeps it resuming every five minutes instead of waiting for the next slot.

**Still NOT terminally reconciled.** `accounting_close_report_receipts` for
2026-11-02 08:00Z -> 2026-11-09 08:00Z remains empty. Zero unsupported items is
not a closed book, and the two are not reported as one claim. Historical
certificates and balances are untouched; the superseded `pnl_flows_problem
bad = 2` remains as history.

### 11.4 Withdrawn: the 03:30-03:50 window as proof of activation

Section 10.4 and a prior report treated the 03:30-03:50 America/Chicago daily
preparation window as the engine activation. It is not.

Read together, the owner order and the admission rules say: a reviewed server
change "must enter the existing Hetzner release lane as soon as it reaches
protected main", and "the owning deploy workflow still builds, tests, WAITS FOR
THE CERTIFIED TABLE BREAK, cuts over, and proves the release." Activation is
the certified table break, not a clock. `stage-engine-release.yml` is a signal
with "no SSH, environment, source-write, or restart authority"; its
`Dispatch The Exact Main SHA` job is gated on
`release_required && admission_allowed`, and admission is true only inside the
admitted daily preparation (reservable at most five elapsed hours early) or
with an explicit `owner_window_id`. That job is currently **skipped**.

A certified Backup run authorizes nothing by itself. `3a63852a` is a CANDIDATE
containing both metric producers - it is the #10419 merge and the
`DEPLOY_CONTROL_SHA` the monitoring run used - but no stage run has selected
it, its prequalification is in progress and its Backup is queued. The final
selected revision, qualification, Backup compatibility, seal and thaw all
remain to be verified. Dispatch is the sole release custodian's; this lane
issued none.

### 11.5 The Spin rules are now exercised, not just linted

`aSpinAlertReadsTheLadderItWatches.law.test.ts` proves the rules read gauges
rather than literals - static. #10442 adds
`infra/monitoring/spin-rules.test.yml` and
`scripts/ci/test-spin-alert-rules-with-fixtures.sh`: ten promtool scenarios
driving real series through the real rules, covering the `for: 1m` and
`for: 5m` durations, the 8400s ladder boundary on both sides, the
maintenance-break guard, horse-only and unresolved shapes, and production's own
observed numbers (staleness 7302s, 11 open boards, no human-wait series).

Two scenarios record silent-failure modes rather than passing over them: a
MISSING envelope gauge cannot page at 99999s of staleness, and a MISSING
arrival gauge silences the human rule with a human waiting 5000s. Prometheus
reports an unfirable rule as health=ok/state=inactive - what it reports for a
quiet one. `SpinMetricsStale` covers a STALE gauge; an ABSENT one is this case.

The suite bites: restoring the 60s literal, restoring the 1800s literal, and
dropping the human arm each fail it. promtool is pinned by version and sha256;
it is deliberately NOT wired into CI, because that adds a release-asset fetch
to a shared blocking job and belongs to the CI/infrastructure owner.

**Explicitly unobserved, and not claimed:** no human has occupied a Spin board
in 24 hours, so the delayed-human path has no production positive - it rests on
these fixtures, a read-only constructive check against real profile rows, and
live classification of humans on non-Spin tables. Real metric ingestion and
rule evaluation stay unverified until the engine release that emits the
producers. `78afb154` therefore remains `recovered / escalated`: the one
forward transition that would clear its latch is owed only once the monitoring
correction is actually serving.

## 12. Controller Activation And Remaining Gates, 2026-11-11 06:10Z

Owner of this section: the controller build session (session_01BNteGZSWtNHEdf2djVeBTT).
Sections 8 to 11 belong to the incident-handling lane and are not edited here.

### 12.1 Installed, enabled and verified live

| Component                                        | Identifier                                                                                                                     | State                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Stage B controller                               | PR #10312, merge `f741b472`; migration `20261110000020`                                                                        | installed, enabled, verified live                                                                    |
| Health read and seed corrections                 | PR #10364, merge `2a8d7f90`; migration `20261110045731` (applier run 42861285942, 661 ms)                                      | installed, verified live                                                                             |
| Missed-critical fix, push mirror, reconciliation | PR #10343, merge `6db7d319`; migration `20261110144203`                                                                        | installed, verified live                                                                             |
| Critical escalation activated                    | migration `20261110174051`                                                                                                     | installed; `notify_mode = critical_only`, `mutation_paused = true`                                   |
| Recovered incident leaves escalation             | migration `20261110224707` (incident lane)                                                                                     | installed                                                                                            |
| Fallback reason label                            | PR #10260, merge `70fee8f2`                                                                                                    | serving: engine `05ab41c3` contains it                                                               |
| Controller health collector                      | PR #10378, merge `bdf56877` (pushed from the Mac on SSD2, bytes sha256 `e558a733...` / `f0f9d741...` equal to the tested ones) | merged; NOT serving until an engine containing `bdf56877` is activated                               |
| Controller health alert rules                    | PR #10458, draft                                                                                                               | held: merge only after `reliability_controller_heartbeat_timestamp_seconds` is present in Prometheus |
| World Hub controls                               | World Hub PR #2776, merge `ff67b531`, Vercel `dpl_869HCsQeRqy8F9EbGB2r7yTSmvEE` READY, `/api/health` at `ff67b531`             | published                                                                                            |

Read back at 2026-11-11 06:03Z: 1,358 ticks in 24 hours, 0 failed; heartbeat 35 s;
0 queued, 0 failed notifications, 0 intake rejections in 24 hours; incidents
recovered 198, escalated 10, stale_unverified 5, verifying 2, investigating 2,
closed 2.

### 12.2 Escalation reaches the owner exactly once

- The first post-activation escalation is notification 47, 2026-11-10 18:30Z,
  incident `a974b740` (LightningHandHost.post_commit_obligations_pending):
  message `7a2f580e`, sender `2d1cd6c3-...` (platform identity), conversation
  `5dde8c6a`, first line `AI AGENT NEEDED`, 1,451 characters including the
  agent handoff, `media_metadata` `{kind: reliability_incident, incident_id,
notification_kind: escalation, handoff_version: 1}` as the World Hub
  controls require.
- Every one of the 11 escalations and reminders sent after activation has
  exactly one `social_messages` row for its request id and exactly one
  `push_outbox` row, status `sent` (provider accepted). None of the 47
  escalations or 3 reminders suppressed in observation mode was resent.
- 10 of those 11 messages carry an owner read receipt. Phone delivery is
  confirmed by the owner for the validation push (2026-11-10 01:28 CT);
  provider acceptance alone is not claimed as phone delivery for the rest.

### 12.3 Corrections recorded

- The 2026-11-10 report that `.agent/workflows/browser-testing.md` in World Hub
  held the owner's password in plain text was wrong. The current file and the
  Playwright skill hold a placeholder, and no change to either file from
  2026-08-20 (the oldest commit available to the inspection) carries a real
  value. Older history was not inspected. No change was made.

### 12.4 Remaining gates and owners

1. Collector serving: the sole release custodian activates an engine
   containing `bdf56877`. This lane starts, books or advances no release.
2. Then merge #10458 after the heartbeat series is present, deploy through
   `deploy-monitoring.yml`, and prove detection by reading
   `ReliabilityControllerStale` for (a) a heartbeat older than five minutes
   in the promtool fixture, already proven, and (b) the live series' age.
   Taking the real controller down to prove it is not authorized.
3. Owner-session checks on the published World Hub controls: Open Incident on
   any `AI AGENT NEEDED` message (owner incident view), Copy Agent Handoff on
   a real iPhone. Not observed by this lane; not claimed. A signed-in
   non-owner view is proven only at the database level (42501) because no
   non-owner test identity is configured for agents.
4. Recovery runbooks: none enabled; `mutation_paused` stays true. No narrow
   engine recovery endpoint exists (see `RECOVERY-OWNERSHIP-MAP.md`), so
   every class is detect and escalate.
5. Five producer families remain unknown and stay in `unclassified` triage
   (`EXTERNAL-PRODUCERS.md`).

### 12.5 Verified working routes

- Cloud workspace: repository attached for push; the repo hooks run with
  `AGENT_CLONE_OK=1`, locked `npm ci` at root and `npm ci --ignore-scripts` in
  `server/`, `TMPDIR` and `RUNNER_TEMP` set. Its git (2.43) cannot run the
  pre-push release-withdrawal test that needs `GIT_NO_LAZY_FETCH`, so any
  change touching `server/scripts/collect-monitoring-health.sh` pushes from
  the Mac.
- Mac: `counselors__host_terminal` (git 2.50, GitHub CLI authenticated), work
  under `python3 /Users/smarter.poker/Documents/ssd-tools/ssd-paths.py work`
  (SSD2, verified by `SSD-IDENTITY.txt`), long steps under `nohup` with log
  polling.
- Database: install only through merge, `dispatch-merged-migrations.yml` and
  `apply-merged-migration.yml`; read back `supabase_migrations.schema_migrations`.
- Controller queries: `public.fn_reliability_controller_health()` (service
  role), `smarter_private.reliability_v_controller_health`,
  `smarter_private.reliability_notifications` (state, `push_state`,
  `message_id`), `public.fn_reliability_incident_for_owner(uuid)` (owner).
- Pause and removal: setting `mutation_paused = true` leaves observation and
  escalation running; `notify_mode = 'observe'` suppresses ordinary messages;
  both change only through a guarded migration. Unscheduling
  `reliability-controller-tick` and dropping the two `zzz_reliability_intake_*`
  triggers removes the controller without touching the inbox.

## 13. Acceptance Evidence, 2026-11-11 10:45Z

This section closes the gates listed in 12.4 where evidence exists. It does
not edit sections 8-11, which belong to the other lane.

| Gate                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | State                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Collector in the release candidate  | The engine serves `f7735cca6862b9add06841b8a41c305b3f3ebe01`, which contains #10378 (`bdf56877`), activated by the release owner's run 42994475679. This lane started, booked and advanced no release. That run's two spectator-evidence jobs failed and are the release owner's matter.                                                                                                                                                                                                    | serving                            |
| Collector output reaches Prometheus | Deploy Monitoring run 43005312778 (merge `4982c667`) read `/api/v1/label/__name__/values` on the box. Every rule metric has a series except `poker_cron_job_failing_of_last_20`, which is unrelated, so all five `reliability_controller_*` series the rules read are present. The rules are unlabelled gauges and each expression aggregates to `{}`.                                                                                                                                      | present                            |
| Freshness                           | At 10:41:43Z the heartbeat age at source was 43 s (`smarter_private.reliability_heartbeat`). No `ReliabilityController*` row exists in `operational_alert_events`, so neither critical rule has fired since deploy. This lane holds no Prometheus credential, so the live per-series age was not read inside Prometheus.                                                                                                                                                                    | fresh at source                    |
| Rules (#10458)                      | Independent review approved head `4e5d51f9` with no blocking findings (PR comment 6792905869). Head `5d49da92` added the missing `docs/laws.d` registry entry. Required checks passed on `5d49da92`. Squash-merged as `4982c667` at 10:38Z, outside the break window. Deploy Monitoring succeeded: Prometheus and Alertmanager reloaded, the repo declares 168 rules and the box runs 168, the rules-ahead-of-the-engine guard passed against `f7735cca`, and the delivery canary is alive. | deployed                           |
| Stale and missing-series behaviour  | Proven with the maintained promtool fixtures (`tests/monitoring/reliability-controller-health.test.yml`): a frozen heartbeat fires Stale, and a missing series fires Absent only. The production controller was not stopped.                                                                                                                                                                                                                                                                | proven by fixture                  |
| Non-owner boundary                  | World Hub #2793 run 42997135440 used the existing CI test identity, which is not the owner. The RPC returned 403/42501 with no incident fields. The page showed "Not Authorized" with no `HorseFleetCollapsed` text, at 375 px width.                                                                                                                                                                                                                                                       | proven, application/API level      |
| Owner phone checks                  | The checklist was given to Dan for the existing HorseFleetCollapsed message (incident `17b7b46a`).                                                                                                                                                                                                                                                                                                                                                                                          | awaiting Dan's result; not claimed |

Not verified here: per-rule `health` and `lastError` for the four new rules.
The deploy verifier asserts rule health only for the Spin rules, and this
lane has no supported Prometheus query route. The rules load, and their
series exist.

Review notes accepted, not fixed:

- Stale's "has not ticked" wording is wrong when the textfile freezes for
  another reason. The co-firing `*_stale` alerts identify that case.
- The missing-series fixture starts from no series.

Unchanged: `notify_mode = critical_only`, `mutation_paused = true`, 0
runbooks enabled, suppressed-history behaviour, and the five unknown
producers in `unclassified` triage.
