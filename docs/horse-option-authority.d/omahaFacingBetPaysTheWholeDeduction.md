# omahaFacingBetPaysTheWholeDeduction: Authority For The Live Switch

Built 2026-11-20 by EMERG lane RAKE for the PLO-OWNER lead. This file does not authorize switching the option on. Switches are made only by the lead, through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash chips (table and Lightning), high only. The Omaha facing-bet call verdicts whose win is the pot before the call (`omahaFacingBetEv` on the turn and river, the bare-overpair flop verdict, the multiway river call, the paired-river and value-range reads) deduct a rake share from that pot. Today the share is `rakeDrag`: the marginal rate, which is zero once the pot has reached the rake cap and never holds the jackpot drop. With the option on the share is the whole projected deduction of the pot after the call (`horseCallDeductionFraction`: percentage, heads-up rate, dealt-player cap, jackpot drop, side pots), expressed against the pot before the call (`horseWholeDeductionOfTheCall`, `server/src/engine/HorseCallDeductions.ts`; wiring `omahaFacingBetDeduction` in `HorseLogic.ts`). A fold pays none of that deduction, so none of it is sunk for the call.

The whole deduction is never below the marginal one, so the option can only turn a call into a fold. Public table rules only; one rule for every opponent. Not touched: the flop tree (`omahaFlopFacingBetEv`, which multiplies later pots by the share), every bet and raise price, PLO6, hi-lo, hold'em, tournaments, Diamond tables. The verdicts bound the share at 20 percent, which binds only below about 6 big blinds in the pot. Default OFF in source (read `=== true`). Receipt: `omaha_facing_bet_whole_deduction_priced`.

## What Was Measured

See archive repairs/EMERG/RAKE.md.

- Size of the mispricing: at a 30 big blind pot after the call the whole deduction is 3.1 big blinds (10.3 percent) and the marginal rate prices 0; at 10 big blinds it is 1.6 (16 percent) against 10 percent priced.
- Offline proxy on the 48-hour journal (375 recorded PLO4/PLO5 cash postflop calls with an equity receipt): the mean required-equity shift is 0.9 points and 1 call sits between the two prices. No measurable effect is expected.
- Exact journal replay: not run at the time of the commit (a full test gate held the machine).

Evidence NOT MET for a default-on; a lead switch decision only. Expected verdict of the replay grade: INSUFFICIENT (too few changed decisions).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the offline proxy is in archive repairs/EMERG/RAKE.md and work emerg/rake/work/thin.py)
