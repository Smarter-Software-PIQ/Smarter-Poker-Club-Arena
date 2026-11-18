# Every Enabled Horse Upgrade Now Has A Counter On Its Own Path

Verifying the core and thirteen Horse upgrades on the serving engine (08c27924, 2026-11-12) left five of them (01, 06, 08, 09, 11) with nothing the engine emitted to show the path had run, and three more (02, 04, 10) provable only indirectly. This adds a counter on each of those eight paths, a law that keeps the list complete, and removes one dead call. Evidence only: no decision, wager, think time, queue or deadline changes.

## Counters Added

All are brain fires, flushed to `horse_brain_flush_receipts` with the release that produced them.

| Upgrade             | Counter                                                                                                | What it counts                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Range posteriors | `upgrade01_action_line_posterior`                                                                      | a telemetry-on live postflop decision computed the public action-line posterior                                                                     |
| 02 Card removal     | `upgrade02_card_removal_scored`                                                                        | a telemetry-on live postflop decision scored its blockers                                                                                           |
| 04 Omaha reservoir  | `upgrade04_omaha_reservoir_<holeCount>[_hilo]_seen`                                                    | once per process and reservoir (hole counts 4, 5 and 6), when it is first built; not per decision                                                   |
| 06 Public timing    | `upgrade06_public_timing_hint`                                                                         | a telemetry-on live decision took its think-time hint from public complexity                                                                        |
| 08 Side games       | `upgrade08_rit_chooser_<once or multi>_seen`, `upgrade08_rit_answer_<accept or decline>_seen`          | a run-it-twice answer was decided and scheduled (the delayed send can still be dropped if the hand moves on)                                        |
| 08 Side games       | `upgrade08_insurance_<accept, decline or cashout>_seen`                                                | counted immediately before the insurance answer is sent                                                                                             |
| 08 Side games       | `upgrade08_kill_pot_seen`, `upgrade08_seven_deuce_seen`                                                | that side-game context reached a decision request (Lightning counts seven-deuce only)                                                               |
| 09 Pre-action purge | `upgrade09_preaction_purge_table_seen`, `upgrade09_preaction_purge_lightning_seen`                     | a stale pre-action on a Horse seat was actually cleared                                                                                             |
| 10 Fast recency     | `upgrade10_fast_window_engaged`, `upgrade10_gear_shift_engaged`                                        | a read computation the fast window switched on, in any telemetry-enabled process; it is not gated per decision and is not a count of live decisions |
| 11 Persona mixing   | `upgrade11_indifference_pool`, `upgrade11_indifference_mixed_pick`, `upgrade11_indifference_call_band` | on a telemetry-on live decision the mix pool held more than one candidate with a persona context, and whether the pick differed from the best       |

The table purge is counted only when a pre-action existed; the clear itself is unconditional as before.

Counters that depend on what the tables offer are named `*_seen`. The daily drift audit (`fn_audit_layer_drift`) treats that suffix as an occurrence counter, so a day with no insurance offer or no stale pre-action is not reported as a layer that went silent. The per-decision counters (01, 02, 06, 10, 11) stay ordinary layers and are judged as such.

## The Law

`HORSE_UPGRADE_LIVE_EVIDENCE` in `HorseUpgradeActivationManifest.ts` lists, for each enabled upgrade, the counters on its path. `HorseUpgradeLiveEvidence.law.test.ts` fails when an enabled upgrade has none, or when a listed counter is no longer inside the arguments of an emitting call (`noteFire`, `noteFeature`, `recordWatchcounter`, `noteHorseTelemetryOpportunity`) in non-test engine source. A registry row, a list, an object literal or a comment that only names the counter does not satisfy it. The list is not part of the manifest digest and gates nothing at runtime.

The new counters are registered in `HorseDataLedger.ts` as one receipt family per upgrade (`upgrade01_*` through `upgrade11_*`), so the daily receipt audit knows each key and who fires it. None carries a health ratio: each depends on table mix.

A counter is fleet evidence. It carries no Horse identity and is never proof that a particular Horse exercised an upgrade.

## Street Prewarm

`executeStreetPrewarm` ended with a V31 cell lookup given arguments that are not that function's parameters. It matched no key, returned null and warmed nothing, and had no other production caller. The call is removed. What a prewarm warms is one board-texture memo, as before. Prewarm stays idle-only and is still refused when a Horse action closes the street, because the street event fires inside the commit barrier; nothing was widened and no Lightning caller was added.

## Regression

- `HorseUpgradeEvidenceCounters.test.ts`, 7 cases on the real producers for upgrades 01, 02, 04, 06, 10 and 11. The telemetry-gated counters (01, 02, 06, 11) are shown silent with telemetry off; for 01, 02 and 06 the action, amount and think time are the same either way on the tested hand.
- `HorseUpgradeLiveEvidence.law.test.ts`, 31 cases, including one that exercises the matcher against a registry row, an object literal, a list and comments.
- Existing fixtures extended: the insurance responder in `HorseActionSpaceFreedom.law.test.ts` (2 declines, 1 accept, 1 cashout counted) and the stale pre-action purge in `HorseRealtimeTurnReliability.test.ts`.
- Not behaviourally tested, covered by the source law only: the run-it-twice, kill-pot, seven-deuce and Lightning purge counters.

## Correction To The Previous Entry

`2026-11-12-horse-decision-denominators.md` said the guard-removed Lightning case read 6 for 5 turns. The independent reviewer's mutation read 7 for 5. The count depends on how the guard is removed; the case fails either way.
