# Eight AI AGENT NEEDED incidents of 2026-11-10..11

Owner: Claude session `session_01BNteGY4kfxAYTsquSxRnoQ` (this file). Parallel
owner of three of the fixes: Claude session `session_01BNteGXcb4Y2qYvDoMAsxch`.
Scope: the eight incidents below, root fixes, regression protection, protected
delivery and live verification. No watcher, retry loop, release dispatch or
start hold. Owned SSD checkout:
`/Volumes/SmarterWork/agent-work/extreme-capacity/alerts-20261111-claude`.

## Custody (verified 2026-11-11 17:45Z from PR timelines and remote branches)

| PR                                             | Owner                                         | State                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #10498 lane/fold socket listener               | GXcb session (head `a354ae15`, pushed 17:39Z) | open, auto-merge on                                                                                                                              |
| #10500 horse fleet floors                      | GXcb session                                  | merged 14:27Z (`5f346bb7`)                                                                                                                       |
| #10502 spin `open_boards` counts seated boards | GXcb session                                  | CLOSED 17:40Z by its owner as superseded by #10507; branch deleted; migration `20261111134959` never installed (absent from `schema_migrations`) |
| #10503 handoff trigger WHEN                    | this session                                  | merged 17:43:59Z (`16a5c1a8`), installed                                                                                                         |
| #10506 relative drop reads Lightning           | this session                                  | merged 15:20Z (`caae1e2b`), deployed                                                                                                             |
| #10507 spin stall reads oldest seated board    | this session                                  | open, auto-merge on                                                                                                                              |
| handoff native test                            | this session                                  | branch `test/post-commit-handoff-native`                                                                                                         |
| cash hands counter                             | this session                                  | branch `feat/cash-hands-fleet-counter`                                                                                                           |

The GXcb session's worktree directory was removed, but it is still active: it
pushed #10498 at 17:39Z and closed #10502 at 17:40Z with a replay comment. It
keeps #10498. Engine release custody is the root release owner's
(`docs/ENGINE-RELEASE-RUNBOOK.md`). This session dispatches no release and
promises no inclusion window.

## Incidents

| Incident                             | Title                                             | Root cause                                                                                                     | Fix / owner                              | Deployed                                                                           | Remaining gate                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fd614614-56b8-414a-96ff-17667e0c2e3a | SLOHandsAreNotBeingDealt                          | `< 1 hand/s` September floor                                                                                   | #10451 (other owner, earlier)            | monitoring `4982c667` 10:39Z onward; rule `== 0`                                   | none                                                                                                                                                                                                                                                                    |
| ee77584d-da8d-4535-ad86-e27c5a2e8b35 | LightningHandHost.post_commit_obligations_pending | trigger WHEN admitted only the ServerTableEngine source                                                        | #10503 (this session)                    | `20261111133739` recorded; trigger def names both sources; function marker present | native PostgreSQL regression in CI (handoff test branch)                                                                                                                                                                                                                |
| 647de293-f887-45a9-9fb5-be45b250ae3c | EngineRestartedOutsideTheBreak                    | checked-out pg pool client had no `error` listener; socket loss in a Lightning settle was uncaught (09:55:38Z) | #10498 (GXcb)                            | not serving: engine `f7735cca`                                                     | #10498 merge, then a certified engine release by the release owner                                                                                                                                                                                                      |
| 3a00a7ce-0abf-4a6a-a5a2-30ec05967b49 | SLOEngineAvailability                             | same restart                                                                                                   | #10498                                   | not serving                                                                        | same                                                                                                                                                                                                                                                                    |
| f1b14fca-2251-4d3e-a2ae-202e7f3dc6f8 | SpinFleetProducingNothing                         | last-start clock gated by REGISTERING boards (33 empty) and not reset by the 03:00 park                        | #10507 (this session); #10502 superseded | not deployed: serving rule still the last-start arm                                | #10507 merge, Deploy Monitoring, rule readback                                                                                                                                                                                                                          |
| 71fdf977-39ad-45bd-b11e-bc749ce7ffd2 | HorseFleetThroughputRelativeDrop                  | counted tournament-heavy `poker_hands_dealt_total` against pre-ladder days                                     | #10506 (this session)                    | rule reads settled Lightning hands (monitoring `5db13967`)                         | #10506 narrowed the rule to Lightning, so a Classic-only cash decline is outside it. Restored by the `poker_hands_fleet_total{format}` counter (engine) and then a rule summing cash table hands and Lightning hands, after an engine containing the counter is serving |
| 15b0d37a-fb83-4b2f-92ee-a9401a868003 | HorseCashActionsStopped                           | absolute 150/min September floor                                                                               | #10500 (GXcb)                            | monitoring `5f346bb7` onward                                                       | none                                                                                                                                                                                                                                                                    |
| 17b7b46a-9a6f-424e-b0fa-6f99533e711c | HorseFleetCollapsed                               | absolute 20-table September floor                                                                              | #10500 (GXcb)                            | monitoring `5f346bb7` onward                                                       | none                                                                                                                                                                                                                                                                    |

## Evidence log

- 17:50Z: `20261111133739` recorded in `supabase_migrations.schema_migrations`.
  Trigger `WHEN (new.source = ANY (ARRAY['ServerTableEngine...','LightningHandHost...']))`.
  No post-commit alert has arrived since the install, so no live row has been
  classified yet.
- Native PostgreSQL 17, run from the migration files (handoff test branch), 17/17:
  - preimage: a Lightning handoff with a durable envelope stays critical;
  - candidate: that row becomes a warning; a timeout, a handoff with no
    envelope, a malformed hand, the `fn_post_commit_stranded_watchdog` row and
    an unrelated source stay critical;
  - the install refuses while the watchdog is inactive.
    `post-commit-stranded-watchdog-5m` is active and succeeding every 5 min.
- Spin fixtures pass on promtool 2.55.1 (the production version) and 3.16.0.
  They cover:
  - below, at and above the 8,400 s envelope, plus recovery;
  - the post-park morning (the #10502 shape) and the 11:19Z shape with empty
    boards;
  - the break, both human-wait arms, and missing gauges.

  They were not wired into any workflow before; `scripts/ci/test-fleet-throughput.sh`
  (ci.yml) now runs them.

- Relative drop on Lightning, replayed over the 3 days to 15:00Z: true only
  on 2026-11-10 06:38-09:48Z, a real cash dip.
- At 17:51Z no critical alert was firing. A quiet board is not counted as
  completion evidence.
