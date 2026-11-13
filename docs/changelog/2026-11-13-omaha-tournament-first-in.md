# Omaha Tournament First-In: Small Blind Against The Big Blind, And The Heads-Up Big Blind

Owner order: Dan, 2026-11-12 21:14 Chicago (PLO tournament play), and his 2026-11-13 00:21 Chicago review order (prove the cause, validate each rule against varied opponents, preserve tournament integration).

## What The Hands Showed

Five days to 2026-11-13 06:00Z, PLO4/5/6 tournaments: 61 events audited in full (all 58 MTTs and the three spins or sit-and-gos a person entered); 276,137 Horse preflop decisions; no missing originals. Small blind first in against the big blind alone: 17,735 spots, Horse folded 61.8 percent against Horses and 75.0 percent against people (60 spots). Heads-up big blind against one raise: 17,044 spots, folded 65.5 and 71.1 percent (38 against people). The human-facing samples are small and descriptive only. Evidence: plo-tournament/COVERAGE-AND-STRUCTURE.md, ROOT-CAUSE.md.

## Cause

Not a scale error: the Omaha preflop score is the Hold'em score at the same percentile (HorseEval omahaPreflopStrength), and the share of hands above any bar is the same in NLH, PLO4, PLO5 and PLO6 within one point. The fold comes from the PLO tournament commitment zone (HorsePreflop.ts, a pot raise of a quarter of the stack or more, about 14 BB or less): its unopened stack-off bar (0.56 from the small blind, about the top 16 percent of hands) has no heads-up or blind-versus-blind case, while the regular open path deeper does (0.24 heads-up, 0.30 blind versus blind). Four recorded heads-up final-table folds of the event a person won were replayed from their original public nodes and the Horse's own cards: all four fold with this rule off (5 of 5 seeds each) and raise with it on.

## Change

`HorseOmahaTournamentFirstIn.ts`, called once after the preflop core and only when the core folded, Omaha high, engine-declared tournaments only:

- the small blind against the big blind alone (heads-up, or three-handed after the button folds) plays every hand the engine's class gate lets through (it still folds three or four of a rank) as the pot-limit maximum raise, about 3 to 3.25 BB heads-up;
- the heads-up big blind against one raise, no limper and no caller, at a price of a half or better, calls with its top 75 percent.
  The hand's rank is its percentile among Omaha hands of its size; the engine's own tournament risk premium narrows every share (two points of range per point of premium; at most 0.01 with two players left). It stands aside, keeping the engine's fold: All-In-Or-Fold tables, locked satellite seats, tables of four or more players dealt, and effective stacks deeper than 20 BB. The tournament utility arbiter (Phase 7) still evaluates and owns the final action. Option `omahaTournamentFirstIn` (default on; false is the old engine).

Measured and NOT adopted: the button first in with two players left playing its top 80 percent (it lost to a big blind that re-shoves against it); the direct correction (giving the commitment zone the regular path's own 48 percent heads-up bar), which gained +0.19 BB per hand at 8 and 12 BB but less than the adopted rule in every cell and nothing at 20 BB.

## Evaluation

Protocol declared before running (plo-tournament/eval2/PROTOCOL.md). Mirrored matches, every deal played once from every seat, arm against an opponent; reported as the paired difference rule minus rule-off against the same opponent on the same deals, in big blinds per hand, with the standard error of the per-deal differences. Opponents: the old Horse, a tight Horse (style tag), a wide Horse (style lag), a call-heavy Horse (its big blind calls every raise it would fold), and an adaptive Horse (its big blind re-shoves its top half against any single raise). Acceptance: positive with the 95 percent interval above zero against old, tight and wide at each depth, and no cell anywhere with its interval below zero. Development seed 31337; confirmation on fresh seed 90001 run once.

Heads-up, both rules, confirmation seed (PLO4 and PLO6 pooled, 4,000 hands per cell):

| Opponent   | 8 BB         | 12 BB        | 20 BB        |
| ---------- | ------------ | ------------ | ------------ |
| Old        | +0.50 (0.03) | +0.46 (0.04) | +0.20 (0.06) |
| Tight      | +0.53 (0.03) | +0.50 (0.04) | +0.21 (0.05) |
| Wide       | +0.50 (0.03) | +0.44 (0.04) | +0.18 (0.06) |
| Call-heavy | +0.21 (0.05) | +0.14 (0.06) | +0.06 (0.07) |
| Adaptive   | +0.26 (0.04) | +0.17 (0.06) | -0.04 (0.07) |

Separately on the development seed, the small blind rule alone: +0.49 to +0.52 at 8 BB against old, tight and wide, +0.22 and +0.29 against call-heavy and adaptive; the big blind rule alone: +0.05 to +0.08 at 8 and 12 BB, +0.15 to +0.17 at 20 BB; it met three distinct opponents (old, tight, wide: the call-heavy, limp-heavy and adaptive opponents change only hands where the arm is the small blind, so their rows equal the old one), and none of them punishes a wider big blind defence. Playing 85 percent instead of every hand scored lower in every pooled cell but one (call-heavy at 20 BB: +0.069 (0.038) against +0.057 (0.045), a difference well inside noise).

Three-handed, small blind against the big blind (development seed, pooled, 4,500 hands per cell): +0.24 to +0.27 at 8 BB and +0.22 to +0.25 at 12 BB against old, tight and wide; +0.16 and +0.13 against a call-heavy big blind (development seed only; that opponent defined for the three-handed table, where the confirmation run's call-heavy opponent acts heads-up only and so equals the old one); +0.09 and +0.04 against adaptive; at 20 BB +0.05 to +0.07 against old, tight and wide and indistinguishable from zero against call-heavy and adaptive. Confirmation seed 90001 (pooled): +0.23 to +0.26 at 8 BB and 12 BB against old, tight and wide; +0.12 and +0.09 against adaptive; at 20 BB +0.07 to +0.09 against old, tight and wide and +0.02 (0.02) against adaptive. (The call-heavy opponent equals the old one three-handed: its change is heads-up only.)

## Limits

- Every opponent is a variant of the Horse brain. The human-calibrated league population is qualified for Hold'em only and was not used for Omaha. Measured people in PLO (14 days) are loose (VPIP about 0.72 to 0.75) with a raise rate near the Horses'; the call-heavy opponent is the closest, and gains there are about half of those against the old Horse.
- At 20 BB the gain against an opponent that re-shoves or calls more is not distinguishable from zero.
- Chip EV, not payout EV: heads-up the two are proportional; three-handed (harness payouts 50/30/20; production spins pay one place) they are not.
- Live effect needs days of the `omaha_tournament_first_in` receipt by table size and the walk share; human-facing spots are rare (about 60 small blind and 38 big blind spots in five days).
