# Omaha wave two, delivered on current main

Date: 2026-11-17. Lane: PLO Strategy (wave-two helper of session 01BNteGZ). The PLO4/PLO5 wave-two head built on 2026-11-16 (local 25687a5033b on fe86726582b, never pushed) is merged into main 302be4d2edd. Every option stays default OFF in source; no switch row is written; nothing under `server/release/` is touched. What it is: `docs/changelog/2026-11-16-omaha-wave-two.md`, `2026-11-16-omaha-street-plan-flop-three-way-preflop.md`, `2026-11-16-omaha-bet-size-carries-no-hand-information.md`.

## The merge

Main had gained #11135, #11183 and the PLO6 lane on the same functions. Both sides are kept: `omahaOwnBetRules` runs `plo6MultiwayWeakBetRule` first and applies the limped-pot minimum bet floor on every return it did on main, with the flop and three-way plan layers between; `omahaOwnerRuledFinal` keeps the PLO6 check and then asks the multiway river call and the discipline checks. The PLO6 accessor table gains the key `streetPlanFlopMarginPotShare` with no six-card value (the flop plan serves four and five cards only).

Decisions against main, same seeds, 24 cells (PLO4/PLO5, human-calibrated field and Horse-only, three seeds, every option off and the 32 options live on 2026-11-16 on): 37,096 decisions, identical action and amount and identical decision record (wall-clock fields left out, the public timing stream pinned), 0 illegal actions, 0 fallbacks. With the live options on, one cell's receipts differ and its decisions do not: the lazy big-draw pricing fires `omaha_big_draw_aggression_final_check_unpriced` 8 times in place of the bet and its `_vetoed` twin.

## Screened against the owner's order of 2026-11-17 11:49 America/Chicago

"there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."

| Option                                | What decides                                                                                 | In this delivery                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `omahaStreetPlanThreeWay`             | value of the bet line against the check line, each opponent's own range and tendencies       | unchanged                                                                              |
| `omahaBetSizeByPublicState`           | chooses a size, never bet against check; public information only                             | unchanged                                                                              |
| `omahaMultiwayWeakHandNoBet`          | bet value from fold equity across the players left and equity when called, against the check | unchanged                                                                              |
| `omahaPreflopStackPlan`               | value of the call as the stack it commits                                                    | unchanged; off-only under the preflop range hold                                       |
| `omahaStreetPlanFlop`                 | value of the lines, but a committing line was refused whatever it was worth                  | the refusal is removed: the comparison alone decides, the label only names the receipt |
| `omahaMultiwayRiverCallNeedsStrength` | priced call, but a raise became a call by hand class and player count                        | the raise is no longer touched: it prices the call only                                |
| `omahaNoRiverBluffIntoValueLeader`    | priced bet against check, but only against an opponent labelled a measured value leader      | not rewritten: registered OFF-ONLY until it is a priced comparison for every opponent  |

## The two rewritten options were evaluated, and both lost

Bar written before the runs (archive `plo-handoff-review-01a1cbbd/wave2b-01BNteGZ/eval/PROTOCOL.md`, results `RESULTS.md`): both arms carry the 32 live options, arm A adds the option; Horse-only table and the human-calibrated field with the Horse fixed at one seat; PLO4 and PLO5; three seeds of 4,000 mirrored pairs per cell; two standard errors. 24 runs, 0 illegal actions, 0 truncated streets, 0 fallbacks.

- `omahaStreetPlanFlop`: Horse-only PLO4 -2.05 bb/100 (SE 0.89), a loss beyond two standard errors; Horse-only PLO5 -1.36 (SE 0.86); field PLO4 -1.59 (SE 4.00) and PLO5 -3.92 (SE 3.94), inconclusive.
- `omahaMultiwayRiverCallNeedsStrength`: Horse-only PLO5 -0.27 bb/100 (SE 0.11, 46 divergent pairs), a loss beyond two standard errors on very few decisions; the other three cells are inconclusive (18 call-to-fold receipts in 192,000 hands).

Nothing was tuned afterwards. Both are registered OFF-ONLY as options that failed their declared evaluation (`HorseOptionSwitch.ts`), so neither can be switched on. The other four options have no league evaluation of their own except `omahaBetSizeByPublicState` (2026-11-16: it does not cost chips against Horses).

## The option lists

One follow-up list migration, `20261118013329_horse_option_switch_plo_wave_two.sql`, generated by `gen-horse-option-switch-sql.ts` against main: the 256 other options and 43 off-only names of main's newest list (`20261118000436`, the priced rules of #11212) are all kept, seven names are added, four of them off-only (7 style, 263 other, 47 off-only in all) (`omahaPreflopStackPlan`, `omahaNoRiverBluffIntoValueLeader`, `omahaStreetPlanFlop`, `omahaMultiwayRiverCallNeedsStrength`). The branch's stale duplicate `20261116034500` (the play styles list merged as `20261116073430`) and its superseded `20261116085517` are not delivered.

## The play styles and the VPIP floor

The all-options-on conflict sweep found one state (1359: PLO4, facing an open, the floor active) where a pressure style Horse's floor entry was a re-raise. `omahaVpipFloorByLimp` compares the decision with the one a table without the floor gives; that comparison left the style's value-raise, call and 4-bet tightness floored, so it answered "raise" where a table without the floor folds. The three are now unfloored with `tightness`. With `horsePlayStyles` off those fields do not exist and nothing changes. Test: `HorseOmahaPlayStyle.test.ts`, facing an open, every style.

## Measured on the merged head

- Conflict sweep, 39 options on against off, 12 runs, 26,602 decisions: 0 exceptions, 0 illegal actions, 0 receipt refusals. VPIP floor entry is never a raise: 0 of 255 with the 39 options, and 0 of 3 at state 1359 with the 38 options without `horsePlayStyles` (the step that did not run on 2026-11-16).
- Decision time, 400 decisions per cell and table kind, measured while the machine's load average was 33 to 60 on 28 cores (so every figure is high; the `off` rows show by how much). PLO5 turn with the 32 live options: p95 190.2 ms and p99 299.0 ms on main, p95 43.2 ms and p99 72.8 ms on this head; with the 39 options on this head p95 37.6 ms, p99 65.2 ms. PLO4 turn, live options: p99 185.7 ms on main, 76.3 ms here. PLO5 river, live options: p99 116.5 ms on main, 55.8 ms here. With every option off: PLO5 turn p99 26.9 ms on main and 34.0 ms here in the same loaded runs. In the conflict sweep (load about 25) the PLO5 turn with 39 options on was p50 7.8 ms, p95 18.3 ms, p99 30.2 ms.

## Tests

`HorseOmahaStreetPlanLayers.test.ts` (the flop verdict by value), `HorseOmahaMultiwayDiscipline.test.ts` (the call priced, a raise not touched), `HorseOmahaPlayStyle.test.ts` (the floor entry), `HorsePlo6StrategyRegistration.test.ts` (18 accessor keys), `SecondLookIsNotLive.test.ts` (the telemetry-gated sites of the merged rules listed with their counts). The two wave-two test files that compare decision bytes leave out the wall-clock fields the declared-work law leaves out.
