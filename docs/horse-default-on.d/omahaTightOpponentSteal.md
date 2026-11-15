# omahaTightOpponentSteal (#10775, and the pull request that adds this file)

OFF. An opt-in arm (read as `=== true`), acting only in the variants of `OMAHA_TIGHT_STEAL_VARIANTS` (six-card Omaha only). This file is the record of where the option stands against the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md), kept for a later promotion. #10775 added the tight read and both halves (respect and steal) as `omahaTightOpponent`, which also stays off; this option is its steal half alone.

**Owner ruling, 2026-11-14 21:30 America/Chicago (given in the Hand Analysis chat), verbatim:**

> Do not treat an unretained paraphrase as an activation order. My ruling now is: build and deliver the Omaha tight responses, but keep them OFF until the required promotion evidence passes. I am not waiving unmet evidence rows. Preserve this exact instruction in both evidence records. The Omaha tight gate stays open.
> Keep the supported opt-in strategy and maniac receipts moving independently of the default-ON dispute. Review the roughly 10% VPIP recognition threshold as a separate calibration issue; don't loosen it merely to produce witnesses.

Retained copy: Hand Analysis verifier archive, `OWNER-RULING-20261114-2130CT-OMAHA-TIGHT-STAYS-OFF.md`. An earlier head of this pull request (4cc51dc5) read the option as on by default on a paraphrased order; that was wrong and is reverted. The option goes on only when rows 2 to 5 below are met and reviewed.

## Mechanism

MET. `HorseLogic.ts`, the tight block before `icmRisk`: preflop, pot-limit Omaha high, no bomb pot, no all-in-or-fold, one board, mind on, effective stack over 25 big blinds, first in (no raise, no limper) from late position or the small blind. If EVERY player left to act is a proven tight folder (`HorseOmahaTightOpponent.omahaTightRead`: 15 or more decayed hands, the aggressive presumption disproved, VPIP credibly at most 0.6 of the Horse mean at 0.9, nothing read wide, not raising again), `omahaTightSteal` lowers the open bar by half of `P(all fold) - risk / (risk + dead)`, at most 0.10, with `P(all fold)` the product of `1 - posterior VPIP`. It only ever opens more. The respect branch is not reached by this option.

Fixed node (`HorseOmahaTightOpponentSteal.test.ts`): PLO6 cash, four-handed, button first in, both blinds proven tight folders: `Qh7s8d5h3c2d` and `QdJc8h6s4c3d` fold with the option false and open on every seed with it on, receipt `plo_tight_blinds_steal`. One unknown blind: no change. The big blind facing a proven tight raiser with `KdQdJsTs9c8h`: no change (the full option flats it).

## Input fidelity

NOT MET. No recorded production node has a qualifying tight folder behind a six-card Horse, so there is nothing to replay. The fixed nodes are constructed; the opponents' records are built with `observeHandComplete`, not durable production rows (no domain key, donors, table VPIP floor, judged VPIP or second look). The league cells learn opponents in session.

## Value

NOT MET as the rule words it (no per-node table under three stated ranges at recorded nodes). What exists, declared before running (PLO6 audit archive, `phase1-play/tight-plo6-league`, PROTOCOL-2 and its amendment), steal alone, six-card, on minus off in big blinds per 100 hero hands:

| Opponents (preflop persona)                     | Cash, six seats | Tournament, six seats | Cash, four seats |
| ----------------------------------------------- | --------------: | --------------------: | ---------------: |
| Extreme nit: plays 2.5%, raises 2%              |    +6.69 (0.33) |         +13.01 (0.36) |              n/a |
| Tight and passive: plays 7%                     |    +3.98 (0.44) |          +6.76 (0.47) |              n/a |
| Tight and aggressive: plays 6%, all raised      |    +3.38 (0.50) |          +6.72 (0.54) |     +7.95 (0.69) |
| Moderately tight: plays 12%                     |    +0.95 (0.36) |          +1.41 (0.33) |     +3.10 (0.55) |
| Tight first in, defends the blind 25% (adverse) |    +0.82 (0.46) |          +0.74 (0.45) |     +1.73 (0.83) |
| Loose and passive: plays 85% (control)          |    0.00 (inert) |          0.00 (inert) |              n/a |

No cell is below zero; 0 illegal actions and 0 fallbacks. Sensitivity: the gain falls as the players behind defend more. Against the defender persona it is small and within two standard errors of zero at six seats. PLO Strategy's arithmetic for four and five cards (`tight-default-on-evidence-01UxDLnH/value.md`) has the button steal negative when two players behind each fold 0.745 and every called hand loses; the played-out league against a 25% defender does not reproduce a loss for six-card, but it does not show a clear gain either. These are simulated totals against development personas, not production gains.

## Continuation

NOT MET. The argument depends on how often proven tight folders fold to a first-in raise. That is not measured for six-card from recorded hands: no six-card person qualifies. For four and five cards PLO Strategy measured qualifying Horses folding 35 of 47 (0.745) against the gate's estimate of 0.888. The adverse persona in the value row was built to that rate.

## Reach

Zero against people on 2026-11-14: of the 12 six-card records of non-Horse players with 15 or more decayed hands, none reads as a tight folder (they play 34% to 100% of hands; qualifying needs about 10% or less at six dealt and about 12% at three to five dealt, on a window capped at 43.8 decayed hands). Against Horses it was not measured for six-card; at most 57 of 985 six-handed and 87 of 945 short-handed cash records have a raw rate under any bar, and every player left to act must qualify. PLO Strategy's one-day read for four and five cards found 2 steal nodes in 353,919 in-scope decisions. So this is expected to change very few decisions until a tight six-card player appears.

## Scope

`OMAHA_TIGHT_STEAL_VARIANTS` is exactly `['plo6']`, pinned by test. PLO4, PLO5, hi-lo and Hold'em are unchanged (a five-card control case is in the test file). Cash and ordinary tournaments are both reached; the decision-level cases are cash, the tournament path is covered by the league cells only. Bomb pots, multi-board, all-in-or-fold and stacks of 25 big blinds or less are excluded by the block's own gates. Lightning six-card pools, if any are dealt, share the path.

## Visibility

`plo_tight_blinds_steal` (the steal changed the preflop intent) and `plo_tight_opponent_considered` (read and applied, same intent) are registered in `HorseDataLedger.ts`. While `omahaTightOpponent` stays off, every fire of either comes from this option. Absent or `false` is off; the league card `plo6_omaha_tight_opponent_steal` deals the on arm.

## Limits

- Development personas, not calibrated people; their postflop play is the calibrated Omaha development profile.
- No production node, no recorded continuation frequency, no person in reach: rows 2 to 5 are not met, so the option is off.
- The gate uses `1 - VPIP` as the fold probability, which overstates folding to a steal for players who defend their blinds.
- The evidence standard itself is reachable only by very tight players (about 10% VPIP at six dealt), so ordinary tight regulars are not read as tight. That is a calibration question for the shared read (owner: PLO Strategy), not answered here.
- A natural committed witness against a tight person does not exist yet.
