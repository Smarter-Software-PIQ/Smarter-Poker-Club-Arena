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

Not measured as value. On the anonymised hand, after the check the Horse always calls a bet of a third of the pot (pinned in the test); to a bet of half the pot or more today's brain folds the bare aces at 6 to 11 of 16 seeds, which this option does not change and which is not measured.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, flop, nothing to call, check legal. A set, two pair, a flush draw, eight or more straight outs, a dry rainbow flop and a Horse in position are unchanged. Decision-level cases in `HorseOmahaOopChecks.test.ts`.

## Visibility

Status: MET

Receipt in `HorseDataLedger.ts`: `omaha_bare_overpair_oop_flop_checked`. League cards `plo4_omaha_bare_overpair_oop_flop_check` and `plo5_omaha_bare_overpair_oop_flop_check`.

## Limits

Status: MET

- The made hand is the engine's category: exactly one pair, whichever pair, so top pair and lower pairs without a draw check too.
- No stack-to-pot exception: a low stack-to-pot 4-bet pot is treated like any other (owner instruction; a separate measurement decides whether an exception is needed).
- A gutshot (four outs) counts as no draw.
- Live behaviour is unverified: the option is off.
