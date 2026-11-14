# The Horse Is Proven Legal In Every Kind Of Postflop Spot, Not Only A Heads-Up Flop Opening

The style matrix law (`HorseStyleVariantModeMatrix.law.test.ts`, 2026-11-13) drives the production decision path for nine variants and both modes, but in one spot only: the flop, heads-up, first to act. Only bet and check ever occurred there. A call, a raise, a fold, an all-in, the turn, the river, three or more players, a short stack, a capped fixed-limit street and the pot-limit ceiling were never put in front of the decision worker by a real controller.

Test only: no production source changes, so no decision, wager, think time, queue or deadline changes.

## What Changed

- New law `server/src/engine/HorseDecisionSpotMatrix.law.test.ts`, registered in `docs/laws.d/server-src-engine-HorseDecisionSpotMatrix.md`.
- For each of nlh, plo4, plo5, plo6, plo8, flo8, flh, short_deck and pineapple, in cash and tournament, a real `HandController` deals the hand, every seat calls or checks to the decision street, and the seats ahead of the Horse act through `performAction` from their own menus. A stored Hybrid row is resolved by `resolveHorseHybridProfile`, the request goes through `HorseDecisionWorkerRuntime` `DECIDE_FAST`, and the controller executes the answer.
- Fourteen spots per variant and mode (fifteen in fixed limit), each on two decks, 512 decisions on 512 different decks:
  - heads-up: flop facing a bet; turn and river, first to act and facing a bet;
  - three-handed: flop facing a bet and a call; turn facing a bet and a raise; river facing a check and a bet;
  - six-handed: flop first to act; river facing a bet;
  - full ring (nine seats; seven in plo6): turn facing a check, a bet and a call;
  - short stack: more than the call and less than the minimum raise behind, so the all-in button is the only raise;
  - facing an all-in that covers the Horse; and, deep, facing a shorter stack's all-in;
  - fixed limit only: the turn after a bet and three raises.
- Every decision must be a `FAST_RESULT` with a valid receipt, no `ERROR`, no policy fallback and no `phase15_*fallback*` counter; on the controller's menu; inside the controller's minimum and maximum; in whole chips in a tournament and whole cents in cash; accepted by the controller; with upgrades 01, 02 and 06 (where the manifest declares them) counted exactly once, and upgrade 07 exactly once in tournaments on a context that reconciles for the table size.
- The controller's bounds are recomputed from the betting structure: no-limit may wager the stack; pot-limit may raise to the current bet plus the pot after calling, and bet the pot; fixed limit has one size, the big blind on the flop and twice that on the turn and river, and none once the street is capped.
- Which action the Horse picks is never asserted (decisions are sampled). Instead every action the controller offers is executed on a twin of the same hand, at the minimum and the maximum for a sized wager, and one chip unit outside each bound must be refused. Fold, check, call, bet, raise and all-in must each have been offered and accepted in each of the three betting structures.

## Known Gap, Pinned (Reported 2026-11-14 To The Tournament Strategy Lane)

In a pot-limit or fixed-limit tournament, a Horse facing a bet with more than the call and less than the minimum raise behind holds the menu fold, call, all_in with no `minRaiseTo` or `maxRaiseTo`. The controller executes that all_in as a wager: the whole stack goes in above the bet. When the brain's reference decision is that all_in, `buildTournamentActionCandidates` (`HorseTournamentUtility.ts`) builds no jam candidate, because for these two structures it requires a numeric `maxRaiseTo`. The baseline is then missing from the candidates, the utility refuses with `baseline_not_modeled`, and the shove is played without being priced by the tournament utility (upgrade 07). No-limit builds the jam without the ceiling and is priced. The decision itself is legal and accepted; every other assertion holds for it.

The pricing is a strategy change owned by the tournament strategy lane, so it is not made here. The law pins today's behaviour by name instead, the way the style matrix law pins the Pineapple tournament refusal (`KNOWN GAP upgrade 07 ...`, three tests):

- every shove through the all-in button in those structures is not priced: `phase7_tournament_utility` is absent, the only `phase7_unavailable_*` counter is `phase7_unavailable_baseline_not_modeled`, `phase7_utility_unavailable` is 1 and the decision's `tournamentUtilityRefusal` is `baseline_not_modeled`;
- every fold or call of the same spot in those structures is priced, with no refusal;
- every decision of the same spot in no-limit tournaments is priced, shoves included.

The pin is a rule over whatever the Horse returned, not a list of which decisions shove: actions are sampled and strategy may change them. It requires at least one shove as a witness and fails, saying how to restore witnesses, if there is none. It is green only for that refusal reason and goes red when a shove is priced, so whoever fixes the pricing must replace it with the plain rule. A refusal for any other reason fails in the cells. The pin must never be extended to a multiway spot (see determinism below).

The six reproductions observed on 2026-11-14 (diagnostics, not asserted; spot `hu_flop_short_stack_all_in_is_the_only_raise`, tournament, heads-up flop, Horse in seat 1, big blind 20, menu fold, call, all_in, returned all_in):

| Variant | Deck | Seed       | Horse stack | Pot | To call |
| ------- | ---- | ---------- | ----------- | --- | ------- |
| plo4    | 0    | 1663882339 | 60          | 80  | 40      |
| plo6    | 0    | 1264265673 | 60          | 80  | 40      |
| plo8    | 1    | 2568337932 | 60          | 80  | 40      |
| flo8    | 1    | 2269140658 | 30          | 60  | 20      |
| flh     | 0    | 530853016  | 30          | 60  | 20      |
| flh     | 1    | 547630635  | 30          | 60  | 20      |

## Other Findings, Not Changed

- Heads-up against a shorter stack that is all-in, the controller still offers raise and all_in to the deep stack, and the Horse takes that raise in some decisions. The controller records the raise and returns the uncalled part at once, so it costs exactly the call (asserted by the law); the hand history shows a raise nobody could answer.
- On a capped fixed-limit street the menu is fold, call, all_in to a deep stack, and all_in there means the call: it executes as the call and the rest of the stack stays behind (asserted by the law). Facing an all-in that covers the Horse, all_in on the menu is likewise the call.

## Limits, Stated

- Determinism: every run has the same inputs and the same sampling seed (fixed decks; the action history handed to the brain is restamped at fixed times). That is not the same decisions on every run: production prices some policy packs against a 4 ms wall clock, so wall-clock-budgeted pricing can still vary receipts and counters and, multiway in tournaments, the action. No assertion reads a wall-clock-budgeted counter (none of `phase10_*`, `phase11_*`, `phase12_*`, `phase13_*` or `*_operation_budget`), and none names a sampled action.
- The game state handed to the worker is assembled by test support (`controllerDecisionState`), a mirror of the production builder in `ServerTableEngineTurns.ts` and not the builder itself; `humanUserIds` is absent, and the helper is typed for four variants and called with a cast for the other five.
- Every seat is a Horse: no human opponent, so no opponent memory and no read of an opponent's style is exercised.
- Every decision street is reached through a limped pot (calls and checks only before it): no raised or re-raised pot.
- Postflop only. No antes, straddles, bomb pots, multi-board hands or kill pots.
- The Horse is always making its first decision of the street, so a re-raise coming back to it and the betting-reopening rule are not exercised, except on the capped fixed-limit street.
- Side pots with three or more all-in stacks are not built.
- Stored legacy styles are not repeated here; the style matrix law owns them. Only a stored Hybrid row is resolved.
- Upgrades whose counters depend on what the table offers (03, 04, 05, 08, 09, 10, 11, 12) are not asserted.
- The minimum raise is checked as a floor (the current bet plus one big blind), not recomputed from the last raise.
- Two decks per spot is a sample. A spot type that passes here is proven reachable and legal on those decks, not on every board.

## Regression

- `HorseDecisionSpotMatrix.law.test.ts`: 29 tests, all pass, on repeated runs. It normally takes about 20 seconds; at a load average above 65 it took up to 94 seconds, with the slowest single test at 10 seconds. Tests use the suite's own timeout.
- Mutation: removing the `upgrade01_action_line_posterior` fire in `HorseLogic.ts` fails all 18 cells; making the worker return a bet or raise one chip above the controller's maximum fails all 18 cells (outside the bounds, and refused by the controller). Both restored.
- Mutations on the pin: letting `buildTournamentActionCandidates` build the jam without a numeric `maxRaiseTo` (the shove becomes priced) fails the pinned test; renaming the refusal reason in production fails the pinned test and the cells; with no shove among the witnesses the pinned test fails with its lost-witnesses message. All restored.
- `tests/law-registry.law.test.ts` passes with the new registry file.
