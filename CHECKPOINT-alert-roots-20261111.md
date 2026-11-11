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
