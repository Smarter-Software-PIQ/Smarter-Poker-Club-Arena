# omahaBareOverpairOopFlopCheck (owner ruling 2026-11-15 11:05 America/Chicago, hand 59517323; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59517323 the Horse, out of position with aces and backdoor draws only in a 4-bet pot, bet 99 into 357 on the 5-8-9 two-tone flop. Owner ruling: that is a check every time. The bet comes from the flop EV comparator (`HorseLogic.ts`, the V38 bet menu, receipt `v38_ev_bet`) on a Monte Carlo equity of about 0.33 to 0.51; position enters it as a realisation factor only, and no commitment or stack-to-pot rule made the bet (the stack-to-pot value shift applies at 3 or less on the Horse's own stack, which was 3.27 here; against the caller's stack it was 2.1).

This option (`omahaOopCheckRules`; spot `omahaBareOverpairOopFlopSpot` in `server/src/engine/HorseOmahaOopChecks.ts`) turns a flop bet into a check when an opponent still acts behind, the Horse holds exactly one pair, no flush draw and fewer than eight straight outs, and the flop is two-tone or allows a straight. No opponent read is consulted; it applies heads-up and multiway.

## Input fidelity

Status: MET

Public state and the Horse's own cards only.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run for this option. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run, and its verdict recorded in `docs/changelog/2026-11-15-omaha-oop-bets-that-become-checks.md`.

## Continuation

Status: NOT MET

Mechanism built 2026-11-15 inside this option (`omahaBareOverpairFlopFacingBetSpot` and `omahaBareOverpairFlopFacingBetVerdict` in `server/src/engine/HorseOmahaOopChecks.ts`; `omahaBareOverpairFlopFacingBetRule` in `HorseLogic.ts`, run in `omahaOopCheckRules` and again outermost in `omahaOwnerRuledFinal`). Heads-up, having checked the bare pair and facing the flop bet: never a raise; a call when the expected value of the call clears 2 percent of the final pot, else a fold. The expected value is the Horse's exact cards against the bettor's range by his bet size (the engine's tiered Omaha aggressor ranges), moved by his measured read, at the price, with a 0.75 out-of-position realisation discount (the engine's flop realisation factor; a stated constant, not measured). The facing-bet expected-value model covers the turn and river only, so the flop uses `simulateEquity` on a private seeded stream; the brain's random stream is not read.

Measured before and after (evidence archive `plo-handoff-review-01a1cbbd/overpaircont-20261115/MEASURE.md`, five PLO5 classes, 100 seeds a cell): before, a fold to two thirds of the pot at 100 of 100 seeds and to the pot at 23 to 100 of 100, identical against every read and with every option on; after, one action per cell at every seed, calls falling with the price and with the strength of the read. Not measured as value: no league or production evaluation has been run.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, flop, nothing to call, check legal (the check); heads-up, the Horse having checked and facing one bet it can cover (the continuation). A set, two pair, a flush draw, eight or more straight outs, a dry rainbow flop and a Horse in position are unchanged. Decision-level cases in `HorseOmahaOopChecks.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_bare_overpair_oop_flop_checked`; the continuation: `omaha_bare_overpair_oop_flop_check_called`, `omaha_bare_overpair_oop_flop_check_folded`, `omaha_bare_overpair_oop_flop_check_raise_flatted`. League cards `plo4_omaha_bare_overpair_oop_flop_check` and `plo5_omaha_bare_overpair_oop_flop_check`.

## Limits

Status: MET

- The made hand is the engine's category: exactly one pair, whichever pair, so top pair and lower pairs without a draw check too.
- No stack-to-pot exception: a low stack-to-pot 4-bet pot is treated like any other (owner instruction; a separate measurement decides whether an exception is needed).
- A gutshot (four outs) counts as no draw.
- The continuation is heads-up only; multiway, the whole-stack call and a raise war on the flop keep today's decision. Its 0.75 realisation discount, its size line (a third to 70 percent of the pot) and its 0.5 any-hand share for a measured over-bettor are stated constants, not measured.
- Live behaviour is unverified: the option is off.
