# A fixed-limit hi-lo low half is kept under the weak-high cap (opt-in)

Fixed-Limit lane, 2026-11-14. New `HorseDecideOpts.fixedLimitHiLoLowHalfFloor`, read only as `=== true` (default off). Diagnosis: agent evidence `fixed-limit-01Gw7aDr/L-ADAPTATION-DIAGNOSIS.md` section 3; implementation record: `N-ADAPTATION-FIX.md` section F3.

## The defect

The V40 Omaha pressure cap is a ceiling for a weak HIGH hand (pair 0.28, two pair 0.30 to 0.36, less 0.05 per point of heat). In hi-lo it clipped the whole pot share, low half included. HU-HILO-001 (2026-11-13) floored it at half the low share for pot-limit heads-up rivers only; fixed limit and multiway pots kept the clip. On a real flo8 table three-handed, a nut low with a pair facing one river bet folded 6 of 6 seeds at a 40-chip stack.

## The change

With the option on, `hiLoRiverLowHalfFloor` also applies on a fixed-limit hi-lo river, heads-up and multiway, and the cap is computed by `hiLoCappedRiverShare(joint, cap, floor) = min(joint, max(0.08, cap, floor))`, the same arithmetic as before when the floor is 0. River only: on the turn the low is a draw whose share against a line-conditioned range is not measured.

## What lowShare is, and why nothing is counted twice

`HiLoSplit.lo` is accumulated by `HorseEval.simulateEquity` in the same iteration, from the same opponent holdings and board, as the high share: per runout the hand's fraction of the low half (1/k for a k-way tie for the best qualifying low, 0 with no qualifying low, a better low, or no low at all), averaged over runouts (and over boards for a multi-board read). That iteration's pot share is 0.5 x high + 0.5 x low (whole pot to the high when no low qualifies), so the joint share is never below 0.5 x low share. The floor is never added to the capped high share: the capped value never exceeds the uncapped joint share (a scoop is never priced as its joint share plus its low half) and never falls below 0.5 x low share. The law pins this on the sampler's own output for a scoop, a nut low with no high, a quartered nut low heads-up, a nut low three-way and a board with no low.

## Receipt

`fixed_limit_hilo_low_half_kept_seen` (HorseDataLedger). The league cannot deal fixed limit, so the option is a refused matchup with its reason.

## Tests

`server/src/engine/AFixedLimitHiLoLowHalfIsKept.law.test.ts` (docs/laws.d entry): the floor arithmetic for fixed limit heads-up and multiway, river only, off unchanged, pot-limit unchanged; the no-double-counting bounds on sampler output; heads-up the cap is held at the low half (receipt) and three-way nut lows with a weak high, including a quartered one, do not fold one bet while main folds them; a hand with no low and a weak high still folds.
