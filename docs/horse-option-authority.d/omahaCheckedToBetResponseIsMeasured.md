# omahaCheckedToBetResponseIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane OPEN-ITEMS-3 (lead session 01TLQer8) on the owner's orders of 2026-11-19 (decisions from the math and the measured statistics, public information only, the same rule against every opponent). Evidence NOT MET for a default-on; this file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

An input of `omahaCheckedToBetIsPriced`, default OFF, read `=== true`; it acts only where that option is on (`server/src/engine/HorseOmahaCheckedToBet.ts`, `omahaCheckedToMeasuredResponse`). PLO4/PLO5 cash, one board, high only, heads-up on the river after the one opponent has checked.

Before: the share of the checker's range that continues against a bet is the pot odds of the bet scaled by his river call rate, or with no river evidence by his all-street continue rate (the pooled read counts every street in one counter: about half), taken as observed at 0.6 pot. With no read at all it is the pot odds themselves (half his range against a pot-sized bet) and its error is that of a rate from no opportunities, which no bet clears.

With the option on: his continue and raise shares at each bet size are the ONE measured answer to a river bet, the same for every opponent (2026-11-20: the person and Horse cells of the table pooled by their counts; the first build keyed the curve on whether the opponent was a person or a Horse, which the binding rule forbids; the grades recorded below were taken on that first build and do not stand for this one: regrade on real chips before any switch) (`HorseOmahaSmallBetConstants.OMAHA_SMALL_BET_RESPONSE`: public actions on 5,379 PLO4/PLO5 cash hands, 2026-11-13..17), moved in log-odds at every size alike by logit(his own rate) - logit(the population mean of the same statistic): his river call rate beside the population's, else his continue rate beside the population's. No evidence: exactly his kind's curve. Evidence but no population figure: the model prices him as before. The error is the binomial error of the measured cell joined with the error of his own rate. The checking range, the fitted showdown share and continue equity, the raise branch, the rake and the margin (the comparison's own standard error) are unchanged. Several opponents, the turn, PLO6 and tournaments are untouched.

Receipt: `omaha_checked_to_bet_measured_response`.

## Constants

None new. The curve is `OMAHA_SMALL_BET_RESPONSE` (already in source, sha256 of its measurement in that file): a person continues against a river bet of two thirds of the pot 20% of the time in PLO5 (n 92) and 33% in PLO4 (n 69), against a pot-sized bet 15% (n 142) and 27% (n 109); a Horse 27% and 28%, then 22% and 13%. The population means are the read envelope's own (`HorseOpponentExploit.exploitEnvelopeFor`).

## What Was Measured

Held-out check of the curve (2026-11-17..19, not the window it was measured on): a player who had checked the river continued against a Horse bet of 0.8 pot or more 4 of 48 times on Nov 17-18 and 4 of 26 on Nov 19.

A first variant (his own pooled rate as the level at 0.6 pot, the measured shape) was graded as an increment and withdrawn before this one was written: 7 changes, fit -118.3 bb (SE 86.0), held out +234.5 (SE 25.2, 2 hands).

Graded on the exact journal replay of 2026-11-18..19, river decisions with nothing to call (593), base = the live option set of 2026-11-19 11:26 PM Chicago, the opponents' real cards (offline only), bb; criteria and this variant's arms declared before it was run (`emerg/open-items/work/oi3/CRITERIA-OI3.md`, addendum 5).

| Arm                                                                       | Changes | Fit, bb (SE), Hands | Held Out, bb (SE), Hands |
| ------------------------------------------------------------------------- | ------- | ------------------- | ------------------------ |
| omahaCheckedToBetIsPriced + omahaCheckedToBetInLightning                  | 19      | +345.5 (111.2), 11  | +51.1 (11.8), 8          |
| the same + this option                                                    | 52      | +478.4 (322.7), 31  | +557.4 (231.7), 21       |
| this option as an increment over the first row                            | 33      | +114.7 (295.2), 20  | +507.8 (222.4), 13       |
| tables only (omahaCheckedToBetIsPriced + this option, against the parent) | 9       | -25.6 (25.7), 4     | +250.0 (110.8), 5        |

Held out, the three options together: Lightning pools +283.4 (SE 200.1, 12 hands), tables +274.0 (SE 126.2, 9 hands). The combined arm passes the declared bar on both days; the increment of this option alone is positive on both days and beyond one standard error on the held-out day only. 26 of the 33 added bets are bluffs: if every opponent called every bet the three options together grade -945.4 (SE 436.0) on the fit day and -416.8 (SE 410.7) held out. The value is the folds.

Limits: a day and a half of decisions; the bets are graded at a measured response, not at what those opponents did (they were checked to and never faced the bet); persons can adapt, and the rule follows a player only through his own measured rates.

## Tests

`server/src/engine/HorseOmahaCheckedToBetMeasuredResponse.law.test.ts`: the curve with and without his own evidence; a measured station keeps the check with a hand that cannot win when called; without the parent option nothing changes; several opponents, the turn and PLO6 byte-identical with the option on.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the graded exact journal replay of 2026-11-18..19 is in archive repairs/EMERG/OPEN-ITEMS-3.md and work emerg/open-items/work/oi3/g-ct2.out, g-ct2-inc.out)
