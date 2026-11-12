# Eight AI AGENT NEEDED incidents of 2026-11-10..11

Owner: Claude session `session_01BNteGY4kfxAYTsquSxRnoQ` (this file). Parallel
owner of #10498, #10500, #10502 and #10509: Claude session
`session_01BNteGXcb4Y2qYvDoMAsxch`. Scope: the eight incidents below, root
fixes, regression protection, protected delivery and acceptance. No watcher,
retry loop, release dispatch, competing cutover or start hold.
Owned SSD checkout: `<ssd work>/alerts-20261111-claude-b` (the earlier
`alerts-20261111-claude` checkout was removed; ownership continues).

## Classification (2026-11-11 20:50Z)

- **4 fully closed:** fd614614, f1b14fca, 15b0d37a, 17b7b46a.
- **1 installed, natural observation pending:** ee77584d.
- **2 awaiting engine deployment:** 647de293, 3a00a7ce.
- **1 partially covered:** 71fdf977. Its false page is fixed, but fleet-wide
  cash coverage waits for #10511 to serve and #10516 to deploy.

## Incidents

| Incident                             | Title                                             | Fix / owner                                                                                                  | Deployed (verified)                                                                                                                     | Acceptance evidence                                                                                                                                | Remaining gate                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fd614614-56b8-414a-96ff-17667e0c2e3a | SLOHandsAreNotBeingDealt                          | #10451 (earlier owner)                                                                                       | rule `== 0`, monitoring since `4982c667`                                                                                                | `tests/monitoring/slo-no-hands.test.yml`                                                                                                           | none                                                                                                                                                                                     |
| ee77584d-da8d-4535-ad86-e27c5a2e8b35 | LightningHandHost.post_commit_obligations_pending | #10503, #10513 (this session)                                                                                | `20261111133739` recorded; trigger WHEN names both sources                                                                              | #10513, PostgreSQL 17 in CI, 17/17 (see below)                                                                                                     | natural reclassification of a live Lightning handoff not yet observed; no event will be manufactured                                                                                     |
| 647de293-f887-45a9-9fb5-be45b250ae3c | EngineRestartedOutsideTheBreak                    | #10498 (GXcb), merged `6340d874`                                                                             | NOT serving: `f7735cca`; container lane session has no `connect` listener                                                               | #10498 regression tests: real PostgreSQL 17 + pg 8.23.0 terminate an in-flight backend, and the call answers UNKNOWN with no uncaught exception    | a certified release containing `6340d874` (custodian request below), then serving-code readback, seal, thaw and resumed play. A later quiet period is not proof of the failure path.     |
| 3a00a7ce-0abf-4a6a-a5a2-30ec05967b49 | SLOEngineAvailability                             | #10498                                                                                                       | NOT serving                                                                                                                             | same                                                                                                                                               | same                                                                                                                                                                                     |
| f1b14fca-2251-4d3e-a2ae-202e7f3dc6f8 | SpinFleetProducingNothing                         | #10507 (this session); #10502 superseded and closed by its owner, migration `20261111134959` never installed | monitoring `694b6d5c`; loaded rule reads `poker_spin_unfilled_oldest_wait_seconds > poker_spin_ladder_full_envelope_seconds`, health ok | promtool in ci.yml (job 130700979515): below, at and above the bound, recovery, post-park morning, empty boards, break, human arms, missing gauges | none                                                                                                                                                                                     |
| 71fdf977-39ad-45bd-b11e-bc749ce7ffd2 | HorseFleetThroughputRelativeDrop                  | #10506, #10511, #10516 draft (this session)                                                                  | serving rule reads settled Lightning hands only; `poker_hands_fleet_total` not emitted by `f7735cca`                                    | #10516 promtool: a Classic collapse that halves all cash fires; a tournament collapse with cash flat stays silent                                  | an engine with `3e5ef384` serving, then counter ingestion and labels, #10516 checks, merge and monitoring deploy, and a rule readback showing cash + Lightning with tournaments excluded |
| 15b0d37a-fb83-4b2f-92ee-a9401a868003 | HorseCashActionsStopped                           | #10500 (GXcb)                                                                                                | deployed                                                                                                                                | #10500 promtool                                                                                                                                    | none                                                                                                                                                                                     |
| 17b7b46a-9a6f-424e-b0fa-6f99533e711c | HorseFleetCollapsed                               | #10500 (GXcb)                                                                                                | deployed                                                                                                                                | #10500 promtool                                                                                                                                    | none                                                                                                                                                                                     |

## Ordinary Classic coverage

`ClassicCashFloorDark` (#10509, GXcb, merged `c4ade03e`) is loaded on
engine-01 with health ok. It pages when Classic cash actions (all audiences)
are zero for 15 minutes outside the break or an owner park. Its measured
basis: the rate never reached 0 in the six days to 17:50Z, and the quietest
healthy hour is about 0.7 actions/s.

Intended withholding stays distinct from a stall:

- the owner plan withholds Classic games by the hour, but three Classic games
  run in the `always` window, so no hour is scheduled dark;
- `theClassicFloorIsNeverScheduledDark.law.test.ts` fails the build if a plan
  edit would ever schedule the whole Classic floor off. It was mutation-checked:
  emptying `always` overnight fails at 04:30 Chicago.

A partial Classic decline that does not halve all cash is not paged. That is
by design, because a relative Classic arm ran 9 false runs in 6 days
(#10509 measurement).

## Release coordination

The active custodian is the Codex agent of chat `01a1cbbb`, holding window
`2026-11-11-horse-realtime-10454-engine-1930z` (admission 19:30-22:30Z, #10514).
No Stage dispatch had been made by 20:45Z. The routine path is the
04:00 Chicago daily release ("Routine engine updates are queued for 04:00
America/Chicago", Stage run 43088206614).

Backup certified `3e5ef384` (43077906194) and `c51a96c2` (43080605718). Both
contain `6340d874` and `3e5ef384`.

Request for explicit inclusion confirmation or handoff: #10514 comment 6806731355. Inclusion is not assumed.

## State at 21:05Z: external blocker, ownership retained

- **GitHub Actions** has been in a major outage since 20:48Z (githubstatus.com
  incident "Impact across multiple GitHub products including Actions"). Every
  repository run is queued, including this PR's 52 checks and #10516. The
  outage authorizes nothing: no manual deployment, no competing release. When
  service recovers, inspect queued and in-flight runs before retrying
  anything.
- **Release custodian** (Codex chat `01a1cbbb`, window
  `2026-11-11-horse-realtime-10454-engine-1930z`, expiry 22:30Z) has not
  replied on #10514 (comments 6806731355 and 6807000404). No owner-window-ready
  issue exists for this window. No Stage dispatch by 21:05Z. Serving engine
  `f7735cca`.
  - The custodian has been asked to record: the operation's terminal
    disposition, its selected SHA, the next supported route for `6340d874`
    and `3e5ef384`, and acceptance or refusal of inclusion.
  - Window expiry transfers nothing and authorizes no candidate. Inclusion
    will be verified against the actual selected SHA, with its certificate
    and schema compatibility revalidated.
- **Classic floor law.** The negative test edited only a local copy of
  `server/src/services/horseUnionCashPlan.json` inside this session's isolated
  checkout, and restored it. No committed file, no production schedule and no
  database row changed. #10509's `ClassicCashFloorDark` is unchanged.
- **Labels kept honest.** ee77584d's live reclassification is naturally
  unobserved. 647de293 and 3a00a7ce rest on #10498's failure-path tests; a
  quiet production interval after deployment is not proof of recovery.

Remaining owned work, in order:

1. Merge #10523 after its required hosted checks pass.
2. After the custodian's release serves `6340d874` and `3e5ef384`:
   - read back the serving code, seal, thaw and resumed play;
   - check that `poker_hands_fleet_total{format}` is ingested with correct
     labels, increments only for table-engine hands (cash hands plus settled
     Lightning hands match `hand_history` with no overlap), and survives
     counter resets through `rate()`.
3. Take #10516 out of draft: checks, merge, Deploy Monitoring, and a rule
   readback showing both cash formats are counted and tournaments excluded.

This session stays open until those steps finish or a successor explicitly
accepts them.

## Successor acceptance 2026-11-12 15:27Z (root 01a1d05b)

Owner explicitly assigned only completion of this handoff. Existing clean SSD2
checkout and #10523 recovered; no competing release initiated. Current release
custodian is root 01a1d015, per decision-engine checkpoint takeover at 14:10Z;
its bounded database prerequisites and release remain independently owned.
Public health at 15:24Z still serves f7735cca6862b9add06841b8a41c305b3f3ebe01.
Thus #10498/#10511 adoption remains UNVERIFIED, not delivered.

Policies read via canonical reader at 15:23:43Z, version 2.9; all four canonical
files plus repository AGENTS, CLAUDE, playbook, publishing and this checkpoint
read. Policy hashes: OWNER f5633d1b9e2b3d3ad7f30dea9e89691ec3044e05ff68471e7d9d8de36e079256;
OPERATING a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5;
HARDENING d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e;
INDEX adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555.
Repository policy check passes. Canonical comparison reports byte drift only
in policy-manifest.json whitespace; the four owning policy bytes match exactly.
No policy source change is needed for this assignment.

#10523's actual failure was law-registry.law.test.ts: the new Classic guard
had no registry entry. Added its required entry; focused registry 1506/1506 and
Classic guard 2/2 pass after integrating protected main d1af68bc. Current plan
still schedules Classic every hour (now more always games); no production
schedule or row changed. Execution preview: documentation/verification, required
gates unchanged. Historical Actions outage is not a present blocker.

Overlap recovered: #10534 is another open combined-cash implementation. Neither
it nor #10516 may overwrite #10590, now merged as d1af68bc and successfully
published by monitoring run 43243331986, which protects same-admission-policy
baselines. Reconcile the combined rule against that exact source before delivery.
Security disposition retained from the maintained process-listing incident:
exposure remains unconfirmed, credential types unknown; #10479 repaired the two
argument-bearing paths. No credential values or process arguments read here.
Evidence: extreme-archive/alerts-closeout-01a1d05b (failed-job log and registry
result). Natural Lightning observation remains to be read; not inferred closed.

### Required-check recovery 15:34Z

#10523 push 697a2aff verified; CI43248289071 database shards failed before
execution: PGDG resolute publishes pg_cron 1.6.8 +3 requiring server >17.12
while newest server is17.11. Its retained +2/+1 builds accept17.11. This is a
necessary delivery blocker, so the smallest shared installer correction will
select the newest cron build compatible with the selected PostgreSQL server,
using signed apt metadata; signature verification and all database tests stay.

## Reconciled successor evidence (2026-11-12 16:06Z)

#10523 protected merge67b116f8398b9cabadd5439f2d0a3631a2672980 at16:00:43Z;
exact headda0af149, CI43249524207 SUCCESS. Merged guard, registry and installer
bytes match reviewed source. Installed/loaded Classic rule agrees with the
current always-on schedule; the negative test never changed production.

#10516 recovered in SSD2 worktree alerts-closeout-01a1d05b-cash. Source now
preserves #10590's same-policy eligibility, requires both cash populations in
historical windows, uses a Lightning-only fallback while combined history warms,
and preserves one alert identity and both suppression guards. Focused promtool
2.55.1 and3.16 fixtures pass; five retained cases cover Classic collapse,
tournament exclusion, counter reset, missing Classic history and policy change.
Existing policy fixtures remain. Normal prepush passed10files/881assertions;
b5bbc1ab pushed, draft retained. #10534 overlap is NOT yet closed/superseded:
only actual merged and loaded equivalent coverage may establish that.

Live Prometheus readback retained as loaded-rules.json in
extreme-archive/alerts-closeout-01a1d05b. All six assigned rules health=ok and
inactive, including corrected oldest-seated-board Spin rule; SLO no-hands reads
==0 and Classic retains break/park exclusions. Monitoring release d1af68bc,
run43243331986 SUCCESS; throughput still Lightning-only pending engine producer.

Read-only production evidence at15:29Z: migration20261111133739 recorded;
a2_post_commit_handoff_is_a_warning trigger names both exact sources; function
requires exact predecessor_pending error, valid UUID and persisted non-null
post_commit_payload. Timeout, missing envelope, malformed identity, unrelated
source and stuck watchdog retain critical semantics. Watchdog active=true.
Maintained PostgreSQL qualification43250518711 SUCCESS at15:42Z independently
retains those boundaries and install-refusal checks. No new production failure
or synthetic alert was generated. No Lightning source event after13:37:39Z
November11 existed at readback, so natural reclassification remains UNOBSERVED.

Eight-incident acceptance (database recovery is not permanent-fix acceptance):

- fd614614 / SLOHandsAreNotBeingDealt: PASS, #10451 loaded source, maintained
  slo-no-hands fixture; database status closed/resolved_signal.
- ee77584d / Lightning post-commit: PASS installed/tested #10503/#10513;
  UNVERIFIED natural execution, explicit absence above; database closed.
- 71fdf977 / relative throughput: PARTIAL, #10506/#10590 live, #10516 prepared;
  database recovered after a10:40Z recurrence, not a claim of combined coverage.
- 15b0d37a / cash actions: PASS #10500 loaded, fixtures retained; database closed.
- 17b7b46a / fleet collapsed: PASS #10500 loaded, fixtures retained; database closed.
- 647de293 / outside-break restart: UNVERIFIED serving #10498, database recovered
  after06:24Z recurrence. Current enginef7735cca lacks the correction.
- 3a00a7ce / availability: UNVERIFIED serving #10498 despite database closed.
- f1b14fca / Spin: PASS #10507 loaded, oldest wait/ladder plus human wait,
  maintenance and missing-gauge fixtures retained; #10502 not revived.

Release custodian root01a1d015 explicitly confirmed #10498/#10511 inclusion in
qualified08c27924, retains sole cutover/certification. DB prerequisite original
43249545194 installed and fully thawed110tables; engine stillf7735cca. Await
that owner's actual selected/sealed SHA, full thaw and gameplay receipts, then
verify emitted/scraped format labels and natural counter increments before
#10516 ready/merge/DeployMonitoring and loaded-query proof. No competing release.

Security finding retains the existing unconfirmed disposition, unknown types,
#10479 source repair and existing account-holder ownership. No rotation adopted.
Final publication/acceptance receipts will be appended to #10516's delivery
record; this checkpoint names its exact outstanding gates without claiming green
CI, recovery or an idle rule establishes engine adoption or natural failure use.
