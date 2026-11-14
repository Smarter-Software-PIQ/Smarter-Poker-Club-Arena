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

## Defect Found, Not Fixed Here

One test is left failing on purpose: `KNOWN DEFECT upgrade 07: the all-in button as the only raise, pot limit and fixed limit tournaments`.

In a pot-limit or fixed-limit tournament, a Horse facing a bet with more than the call and less than the minimum raise behind holds the menu fold, call, all_in with no `minRaiseTo` or `maxRaiseTo`. The controller executes that all_in as a wager: the whole stack goes in above the bet. When the brain's reference decision is that all_in, `buildTournamentActionCandidates` (`HorseTournamentUtility.ts`) builds no jam candidate, because for these two structures it requires a numeric `maxRaiseTo`. The baseline is then missing from the candidates, the utility refuses with `baseline_not_modeled`, and the shove is played without being priced by the tournament utility. No-limit builds the jam without the ceiling and is priced. Six of the twelve short-stack decisions in those structures reproduce it (plo4, plo6, plo8, flo8, flh). The decision itself is legal and accepted; every other assertion holds for it.

## Limits, Stated

- Postflop only. No antes, straddles, bomb pots, multi-board hands or kill pots.
- The Horse is always making its first decision of the street, so a re-raise coming back to it and the betting-reopening rule are not exercised, except on the capped fixed-limit street.
- Side pots with three or more all-in stacks are not built.
- Stored legacy styles are not repeated here; the style matrix law owns them. Only a stored Hybrid row is resolved.
- Upgrades whose counters depend on what the table offers (03, 04, 05, 08, 09, 10, 11, 12) are not asserted.
- The minimum raise is checked as a floor (the current bet plus one big blind), not recomputed from the last raise.
- Two decks per spot is a sample. A spot type that passes here is proven reachable and legal on those decks, not on every board.

## What The Controller's Menu Means In Three Spots

Recorded because the law depends on it, and because two of them read oddly:

- Facing an all-in that covers the Horse, the menu is fold, call, all_in; all_in there is the call.
- On a capped fixed-limit street the menu is fold, call, all_in to a deep stack; all_in executes as the call and the rest of the stack stays behind.
- Heads-up against a shorter stack that is all-in, the menu still offers raise and all_in to the deep stack. The controller records the raise and returns the uncalled part at once, so it costs exactly the call (asserted). The Horse takes that raise in some of these decisions; the hand history then shows a raise nobody could answer.

## Regression

- `HorseDecisionSpotMatrix.law.test.ts`: 25 tests pass, 1 fails on purpose (the defect above). Ten consecutive runs gave the same result and the same six reproductions, in 19 to 28 seconds each; the action history handed to the brain is restamped at fixed times, so the 512 decisions are the same on every run.
- Mutation: removing the `upgrade01_action_line_posterior` fire in `HorseLogic.ts` fails all 18 cells; making the worker return a bet or raise one chip above the controller's maximum fails all 18 cells (outside the bounds, and refused by the controller). Both restored.
- `tests/law-registry.law.test.ts` passes with the new registry file.
