# omahaEliteContinuesVsMeasuredWideThreeBettor (PLO Strategy lane 2026-11-15; branch agent/plo-3betdef-01BbZPDi/fix/omaha-elite-continues-vs-measured-wide-three-bettor, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

When a PLO4/PLO5 cash Horse opens and a player with an observed maniac raise width re-raises it, the decision is made by the maniac-price arithmetic in `server/src/engine/HorseLogic.ts` (V38 with the V53 realization charge; `maniacPrice38` is true for any observed maniac raiser once `raises >= 2`), before the range play and the V86 shallow 4-bet. The call is taken when sampled equity clears `required38`.

Values at the census node (six-handed, 100bb, blinds 1/2, Horse opens to 7 in the cutoff, the button re-raises pot to 24; 17 to call into 34; the production PLO5 winner's decayed counters: 40 hands, raises 55%, opens 82% of 20, re-raises 33% of 15):

| Input                                                                                                | PLO4      | PLO5      |
| ---------------------------------------------------------------------------------------------------- | --------- | --------- |
| Raw pot odds 17 / 51                                                                                 | 0.333     | 0.333     |
| After the rake drag (0.10 at this node)                                                              | 0.370     | 0.370     |
| Domination margin (0.04 + 0.02 per hole card above four)                                             | 0.04      | 0.06      |
| V53 realization (pressure target re-raised the Horse's open; 0.10 out of position, 0.05 in position) | 0.10      | 0.10      |
| Required equity                                                                                      | 0.510     | 0.530     |
| Monte Carlo samples (0.8 of the variant's iterations, floor 160)                                     | 176       | 160       |
| Sampled range (percentile band)                                                                      | 0.31 to 1 | 0.30 to 1 |

The sampled range is his whole maniac raise width (`maniacRaiseWidth`, the larger of his opening and re-raise widths, here 0.69 to 0.70; 0.81 at his 834-hand sample), not his measured re-raise rate; at 15 opportunities the re-raise statistic has not engaged at all. So the range assumption is already wide. The fold comes from the price: 14 (PLO4) and 16 (PLO5) points of fixed margin on top of pot odds put the bar at 51% and 53% raw equity, a double-suited rundown has about 51% (PLO5 top 15%: mean 0.509 against the 40-hand read, 0.534 against the 834-hand read) and each estimate carries about 4 points of sampling error. Two hands at that node, seeds as in the census: PLO5 `8c 7c Th 9s 6h` equity 0.444 against 0.530, fold; PLO4 `8c Td 9c 7d` equity 0.483 against 0.510, fold. PLO5 folds more than PLO4 because its bar is 2 points higher while its equities are no higher (top-15% nut-suited ace hands 0.555 against PLO4's 0.579, double-suited rundowns 0.509 against 0.508; 4,000 deals), and because the PLO5 class read admits hands below the top 15% of the percentile that PLO4's does not (PLO5 double-suited rundowns below it: mean equity 0.489). Trace: archive `plo-handoff-review-01a1cbbd/3betdef-20261115/trace-before.json`.

With the option on, at the point where that arithmetic refuses the price, the fold becomes a call when every condition holds: PLO4 or PLO5, cash, high only, one board, no bomb pot; the Horse made the first raise and faces exactly one re-raise by another player; only the re-raiser is committed to the price; the call is under 40% of the stack and the re-raiser is not all in (only the maniac read brought the decision to the arithmetic); raw pot odds call / (pot + call) at most 0.34 (`OMAHA_ELITE_CONTINUE_MAX_POT_ODDS`); the hand's elite class is `broadway_conn_ds`, `rundown_ds`, `kk_ds`, `ax_nut_suited`, `aa_ds` or `aa_dry` and the class read marks it a shallow 4-bet hand; and the re-raiser is a measured wide re-raiser (`wideReRaiser` in `server/src/engine/HorseOmahaReadConditional.ts`: 15+ decayed hands with the Omaha presumption evidenced or disproved on his own counters, 12+ decayed re-raise opportunities, re-raise rate credibly above the Horse mean at 0.9 one-sided with a shrunk posterior mean of 0.15 or more, not withdrawn by a recent window without re-raises). It never creates a raise: the V53 4-bet above it and the range play are untouched. It draws no random number.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the re-raiser (exact context, probe-adjusted), the same counters every exploit read uses. The census builds the node by hand (a table without a rake configuration, so the rake drag is the default) and sets the counters directly.

## Value

Status: NOT MET

Not measured. No outcome was read. The declared paired evaluation is still to be written and run; its verdict is recorded in `docs/changelog/2026-11-15-omaha-elite-continues-vs-measured-wide-three-bettor.md`.

## Continuation

Status: NOT MET

Not measured. The call is out of position in most of these spots against a player who has the initiative; how the Horse plays the later streets after it is unmeasured.

## Reach

Status: NOT MET

Not counted in production. In the decisions census (20,000 seeded deals per game filtered to the four elite classes the class read marks as shallow 4-bet hands, three open-then-3-bet scenarios at 100bb and 60bb) the fold share facing the measured winner's 3-bet moved from 9.8% to 0 (PLO4, 40-hand read), 7.3% to 0 (PLO4, 834-hand read), 34.3% to 0 (PLO5, 40-hand read) and 31.5% to 0 (PLO5, 834-hand read); every changed decision is a fold that became a call; no raise count moved; the unknown and tight arms and every open and squeeze cell are identical.

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board. Hi-Lo, PLO6, bomb pots, multi-board, all-in-or-fold tables and tournaments are outside, as are a 4-bet or more, a re-raise the Horse did not open into, a pot where another player has called the re-raise, and a call of 40% of the stack or more. Decision-level cases in `HorseOmahaEliteContinues.test.ts`: unset and false byte-identical; against the measured wide re-raiser every fold becomes a call and nothing else moves; against a measured wide opener who seldom re-raises, a measured tight re-raiser, an unknown or presumed player, with the mind off, with a non-elite or unmarked hand, in PLO6, Hi-Lo and a tournament the decision is today's.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_elite_continues_vs_measured_wide_three_bettor` (the fold became a call) and `omaha_elite_continues_vs_measured_wide_three_bettor_withheld` (an elite hand refused at that node whose re-raiser is not a measured wide re-raiser, or whose price is above the bound). League cards `plo4_omaha_elite_continues_vs_measured_wide_three_bettor` and `plo5_omaha_elite_continues_vs_measured_wide_three_bettor`.

## Limits

- The option removes every such fold, including PLO5 double-suited rundowns below the top 15% of the preflop percentile (76-79% folds today in the cutoff and under-the-gun scenarios): whether calling all of them is right is exactly what the evaluation has to show.
- It changes only folds the maniac-price arithmetic produces. A measured wide re-raiser whose read is not a maniac raise width is decided by the range play, which this option does not touch; nor does it touch the fixed margins themselves, so non-elite hands are priced as today.
- The pot-odds bound cannot bind against a pot-limit re-raise heads-up (a pot-sized re-raise is one third); it is a guard for other structures and is not exercised by a test.
- The decayed window holds about 44 hands; 12 re-raise opportunities take a while to gather.
- Live behaviour is unverified: the option is off.
