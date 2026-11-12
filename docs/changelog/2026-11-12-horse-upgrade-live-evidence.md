# Every Enabled Horse Upgrade Now Has A Counter On Its Own Path

Verifying the core and thirteen Horse upgrades on the serving engine (08c27924, 2026-11-12) left five of them unprovable: the code was wired, and nothing the engine emitted could show the path had run. This adds the missing counters, a law that keeps the list complete, and removes one dead call. Evidence only: no decision, wager, think time, queue or deadline changes.

## Counters Added

All are brain fires, flushed to `horse_brain_flush_receipts` with the release that produced them. Worker-side fires count only telemetry-on live decisions unless stated.

| Upgrade             | Counter                                                                                                                                                                                                  | Where it counts                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 01 Range posteriors | `upgrade01_action_line_posterior`                                                                                                                                                                        | a postflop decision computed the public action-line posterior                               |
| 02 Card removal     | `upgrade02_card_removal_scored`                                                                                                                                                                          | a postflop decision scored its blockers                                                     |
| 04 Omaha reservoir  | `upgrade04_omaha_reservoir_built_<holeCount>[_hilo]`                                                                                                                                                     | once per process and reservoir, when it is first built                                      |
| 06 Public timing    | `upgrade06_public_timing_hint`                                                                                                                                                                           | the think-time hint came from public complexity                                             |
| 08 Side games       | `upgrade08_rit_chooser_<once or multi>`, `upgrade08_rit_answer_<accept or decline>`, `upgrade08_insurance_<accept, decline or cashout>`, `upgrade08_kill_pot_decision`, `upgrade08_seven_deuce_decision` | the host sent that answer, or that side-game context reached a decision request             |
| 09 Pre-action purge | `upgrade09_preaction_purged_table`, `upgrade09_preaction_purged_lightning`                                                                                                                               | a stale pre-action on a Horse seat was actually cleared                                     |
| 10 Fast recency     | `upgrade10_fast_window_engaged`, `upgrade10_gear_shift_engaged`                                                                                                                                          | a read the fast window switched on (counts read computations, not decisions)                |
| 11 Persona mixing   | `upgrade11_indifference_pool`, `upgrade11_indifference_mixed_pick`, `upgrade11_indifference_call_band`                                                                                                   | the persona band was asked about a real choice, and whether the pick differed from the best |

The table purge is counted only when a pre-action existed; the clear itself is unconditional as before.

## The Law

`HORSE_UPGRADE_LIVE_EVIDENCE` in `HorseUpgradeActivationManifest.ts` lists, for each enabled upgrade, the counters on its path. `HorseUpgradeLiveEvidence.law.test.ts` fails when an enabled upgrade has none, or when a listed counter no longer has an emitting line in non-test engine source. The list is not part of the manifest digest and gates nothing at runtime.

A counter is fleet evidence. It carries no Horse identity and is never proof that a particular Horse exercised an upgrade.

## Street Prewarm

`executeStreetPrewarm` ended with a V31 cell lookup given arguments that are not that function's parameters. It matched no key, returned null and warmed nothing, and had no other production caller. The call is removed. What a prewarm warms is one board-texture memo, as before. Prewarm stays idle-only and is still refused when a Horse action closes the street, because the street event fires inside the commit barrier; nothing was widened and no Lightning caller was added.

## Regression

- `HorseUpgradeEvidenceCounters.test.ts`, 7 cases on the real producers: each counter moves exactly when its path does, stays silent with telemetry off, and the result is identical either way.
- `HorseUpgradeLiveEvidence.law.test.ts`, 30 cases.
- Existing fixtures extended: the insurance responder in `HorseActionSpaceFreedom.law.test.ts` (2 declines, 1 accept, 1 cashout counted) and the stale pre-action purge in `HorseRealtimeTurnReliability.test.ts`.

## Correction To The Previous Entry

`2026-11-12-horse-decision-denominators.md` said the guard-removed Lightning case read 6 for 5 turns. The independent reviewer's mutation read 7 for 5. The count depends on how the guard is removed; the case fails either way.
