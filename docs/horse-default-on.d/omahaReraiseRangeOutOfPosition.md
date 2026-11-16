# omahaReraiseRangeOutOfPosition and omahaReraiseRangeEarlyPosition (owner instruction 2026-11-15 12:18 America/Chicago; branch agent/plo-3betdef-01BbZPDi/fix/omaha-elite-continues-vs-measured-wide-three-bettor, pull request not yet opened)

Two options, each off by default (read `=== true`) and switched separately: `omahaReraiseRangeOutOfPosition` restricts the out-of-position spots, `omahaReraiseRangeEarlyPosition` the early-position spots. They are separate because the production sweep has out-of-position 3-bets from the blinds winning and early-position 3-bets without aces losing. This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: the Horses' 3-bet and 4-bet ranges out of position and under the gun must be capped.

Where the re-raise range is widened today: the wide-opener 3-bet bar and the pressure 3-bet bars in `server/src/engine/HorsePreflop.ts` (`vsOpener.threeBetBar`, `ctx.exploitPressure` with its in-position and out-of-position bars), the VPIP floor, which scales `tightness` and with it every preflop bar (`ctx.vpipFloorMul` in `HorsePreflop.ts`, set from `vpipFloorMul(gs)` in `HorseLogic.ts`), and the maniac-pressure 4-bet in `HorseLogic.ts` (`v53_pressure_four_bet`: a hand 6 points clear of the maniac price 4-bets). All of them sit below the decision's last step.

The rule (`omahaReraiseByPositionCell` in `server/src/engine/HorseOmahaOopReraisedPot.ts`, applied by `omahaReraiseRangeRules` in `HorseLogic.ts`, the function both options share, as the last step on both decision paths, so no path above can re-raise around it): a preflop raise that would be the 3-bet or the 4-bet, in a RESTRICTED spot, stands only with suited aces (class `aa_ds`), any pair of aces when the re-raise commits (the stack-to-pot ratio once it is called is at or under 1), or the engine's declared premium structures without a pair of aces (`omahaReraisedPremium`: kings double-suited; a double-suited rundown, four ranks inside a span of four, the lowest seven or higher). RESTRICTED: the Horse acts before the player it re-raises on later streets, or before a caller already in the pot for that raise; or it sits in one of the first two seats left of the big blind (under the gun, under the gun plus one) at a table of six or more dealt in, with a live player still to act. Blind against blind is never restricted; the middle seats in position, the cutoff and the button keep today's ranges.

Every other hand, bare aces short of that commitment included, calls instead of re-raising. A call that then faces a 3-bet (the Horse would have 4-bet) is judged by the calling rule of `omahaOopReraisedPotStrongRange` (applied whether or not that option is on) and folds when it folds. A call of a single raise (the Horse would have 3-bet) stands for a coordinated hand, for aces, or when its equity against the opener's range clears the price plus the realization margin (0.10 out of position, 0.05 in position); otherwise it folds, so a pressure 3-bet with a weak hand does not become a weak call.

It is implemented as a class requirement on the final decision rather than as shifts of the bars inside `HorsePreflop.ts`: the bars are moved by several layers (the opener read, the pressure read, the VPIP floor, the elite classes), and a shift inside one of them leaves the others able to re-raise.

## Input fidelity

Status: MET

Public state and the Horse's own cards; the mind's range band for the opener when a downgraded 3-bet is priced.

## Value

Status: NOT MET

Not measured, and the production sweep does not support the premise as stated (4,573 human-seated PLO4/PLO5 cash hands, 2026-11-10 to 2026-11-15, each Horse 3-bet and 4-bet with a human still live, whole-hand result; archive `plo-handoff-review-01a1cbbd/3betdef-20261115/position/RERAISE.md`): 3-bets won 6.6 bb a raise out of position (279) against 1.3 in position (319); 4-bets won 32.1 out of position (47) against 10.4 in position (72); early-position 3-bets won 21.8 a raise (55) and 4-bets 6.1 (55). Without a pair of aces, 3-bets won 3.0 out of position (199) and lost 8.1 in position (232); early-position 3-bets without aces lost 9.4 a raise (38). Small samples and very large swings. The declared paired evaluation is still to be written and run.

## Continuation

Status: NOT MET

Not measured.

## Reach

Status: NOT MET

Not counted in production. Decisions census before and with each option on alone (share of hands re-raised by position): archive `3betdef-20261115/reraise-census-split.txt`.

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board, preflop, the 3-bet and the 4-bet. A 5-bet or more, Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside. Tests in `HorseOmahaOopReraisedPot.test.ts`: the cell by class on a seeded census (suited aces, premium rundowns, bare aces, one-group hands, split high/low, big cards with danglers), and the decision on random hands against a measured wide opener with and without the VPIP floor (unset and false byte-identical; out of position and from early position no re-raise outside the capped range; the button and blind against blind exactly as off).

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts` (shared by the two options): `omaha_reraise_by_position_kept`, `_aces_committed`, `_called`, `_folded`. League cards `plo4_` and `plo5_omaha_reraise_range_out_of_position` and `_omaha_reraise_range_early_position`.

## Limits

- Bare aces do not 3-bet or 4-bet in a restricted spot unless the re-raise commits; they call (excused coordination, priced). This gives up value with the best starting pair and is the first thing the evaluation should look at.
- The Horse stops 3-betting from the blinds against steals except with the capped range.
- A hand that would have re-raised and is then folded was a re-raise the base logic judged profitable; the fold is the rule's, not the base logic's.
- Live behaviour is unverified: the option is off.
