# Cash horses play more hands, 3-bet more and open 2.5-4.5bb, at every table size (V85)

Dan, 2026-11-09, after a real player reported for the fourth time that the
cash horses play far too tight: "HORSES ARE PLAYING UNDER 20% VPIP OR LOWER!
FOR A 9 HANDED GAME, THESE NUMBERS NEED TO BE INCREASED TO 25-30% VPIP, AND
INCREASE THE 3 BETTING. HOW DO YOU DO THIS WHILE MAINTAINING GTO DISCIPLINE?
AND THE HORSES ARE ALL OPENING WAY TOO SMALL ... REAL CASH GAME OPENS ARE
2.5-4.5 BB OR LARGER IF THERE ARE LIMPERS", then "THIS NEEDS TO BE FULLY
ADJUSTED FOR 6 HANDED GAMES AND SHORT HANDED PLAY AS WELL".

## What production showed

No-limit hold'em cash, horses, engine `391f7bc0` (serving since 2026-11-07),
2026-11-10 about 02:45-05:45 UTC:

| dealt in | horse-hands | VPIP | PFR  | 3-bet | raise first in |
| -------- | ----------- | ---- | ---- | ----- | -------------- |
| 9        | 7,806       | 15.9 | 11.8 | 4.0   | 18.4           |
| 8        | 1,308       | 17.7 | 12.8 | 2.7   | 21.7           |
| 6        | 53,439      | 26.5 | 17.7 | 5.1   | 30.8           |

The first action of a nine-handed horse facing one open (6 hours):

| seat                   | decisions | fold | call | 3-bet |
| ---------------------- | --------- | ---- | ---- | ----- |
| between opener, blinds | 3,953     | 94.0 | 2.7  | 3.3   |
| small blind            | 1,242     | 90.3 | 4.3  | 5.4   |
| big blind              | 1,250     | 61.8 | 33.0 | 5.2   |

The big blind folded MORE to an open and a caller (71.1%) than to the open
alone. Cash opens with no limper were already 2.50-4.00bb (nine-handed mean
3.37, six-handed 3.09), with the button and cutoff confined to 2.5-3.0bb and a
4x ceiling. Cash stacks are deep: median 253bb, 3.7% under 85bb.

## Causes

1. `DEFEND_TARGET_IP` took 2 points of continue and 0.4 of 3-bet away for
   every player behind the defender. Nine-handed, UTG+1 facing UTG has five:
   its continue width sat on the floor (about 3.5%), and no middle seat reached
   8%. This, not the opening ranges, is why a full table ran 15.9%.
2. Every facing-open width was written against a 2.5bb open and scaled down
   for a bigger one, while cash opens have been 2.5-3.5bb since 2026-11-01.
3. An open that had been called fell back to the five-bucket legacy bars,
   which added 0.025 to the call bar per caller, the big blind included.
4. The 2026-11-03 action profile applied at exactly six or nine dealt in, so a
   nine-seat table with an empty chair played the tighter base, and it moved
   the opening widths by 0.5-2 points only.
5. Heads-up, the cash big blind was outside the per-seat base and folded 56%
   to an open.

## The change (`v85CashAction`, default on; no-limit hold'em cash only)

- **Opens** (`V85_CASH_OPEN_TARGET`), percent raise first in for a balanced
  horse, by players behind: SB 50, BTN 52, CO 35, HJ 27, LJ 22.5, then 20.5,
  18.5 and nine-handed UTG 17; three-handed 50 / 55; heads-up 80. At every
  table of four or more. The hands are still the top of each seat's own
  reference order.
- **Facing an open** (`V85_DEFEND_TARGET`, `V85_DEFEND_TARGET_IP`): each player
  behind costs 0.4 points of continue (was 2) with an 18% floor; the button
  continues 27-35% by opener seat, the small blind 19.5-28%, the big blind
  52-76%; all written against a 3bb open, and a bigger open is still defended
  narrower.
- **3-bets**: wider per-seat 3-bet widths, with the added width taken from the
  strongest calls (`V85_VALUE_SHIFT`); the bluff share stays trimmed (0.6 of
  the reference, was 0.5).
- **An open that was called**: the same base answers it. A squeeze is 0.85x
  (one caller) or 0.75x (two or more) of the cold 3-bet width and more linear;
  an overcall keeps about the cold-call width; the big blind widens 12% per
  caller instead of tightening.
- **Heads-up big blind**: on the base (72% continue, 18% 3-bet).
- **Open sizes** (`NLH_OPEN_BANDS_CASH_ACTION`): early 3.0-4.0bb (3.25-4.25 at a
  full ring), middle 2.8-3.8, cutoff and button 2.5-3.5, small blind 3.0-4.0,
  heads-up 2.5-3.5, deep stacks up to 4.5bb; one big blind per limper as
  before; still drawn from the spot and never the cards.
- **Depth**: all of it tapers with the effective stack, none at 50bb or less
  (decisions identical to the profile off), full from 85bb.

Tournaments, ante tables' own base widths, pot limit, fixed limit, short deck
and pineapple are unchanged. 3-bet sizes were already 3-3.5x in position and
4-4.5x out (`HorseCashThreeBetSize`) and are unchanged.

## How this keeps discipline, and where it leaves the solver

Nothing is a VPIP quota. Each decision is still "is this hand in the top X% of
this seat's order against that seat's open at this price", early opens are
defended narrower than late ones, bigger opens narrower than small ones, and
3-bets stay value-heavy. What moved is X. A solver's nine-handed table plays
roughly 20-23% VPIP; the owner's target is above that, so these widths are
past the solver bands on purpose, most of all in calls behind an open and in
the early seats' opens. The older suites that pin the solver bands
(`HorseGtoOpeningRanges.test.ts`, `HorseDefenceByOpener.test.ts`,
`HorseVs3BetDefence`, `HorseSqueezeDefence`, `HorseHuBbDefence`) now measure
with the profile off, as the reference base they describe.

## Measured: all-horse preflop probe

`server/src/benchmark/HoldemCashActionProbe.ts` (CLI
`server/scripts/holdem-cash-action-probe.ts`), every seat on the fleet's
hybrid cash profile, 8,000 hands a table, 250bb, seed 20261110. With the
profile off it reproduces production nine-handed (16.1 / 11.9 / 4.0 against
15.9 / 11.8 / 4.0; seats behind an open 94.1 / 2.8 / 3.1 against 94.0 / 2.7 /
3.3).

| dealt in | VPIP off -> on | PFR off -> on | 3-bet off -> on | squeeze off -> on | open mean (range) on |
| -------- | -------------- | ------------- | --------------- | ----------------- | -------------------- |
| 9        | 16.1 -> 24.8   | 11.9 -> 13.9  | 4.0 -> 6.6      | 3.3 -> 5.4        | 3.73bb (2.8-4.5)     |
| 8        | 18.1 -> 26.9   | 12.9 -> 15.4  | 3.9 -> 7.2      | 3.7 -> 5.5        | 3.67bb (2.8-4.5)     |
| 7        | 20.3 -> 29.1   | 14.3 -> 17.1  | 4.1 -> 7.7      | 3.1 -> 6.2        | 3.62bb (2.8-4.5)     |
| 6        | 23.7 -> 32.0   | 16.6 -> 19.4  | 5.2 -> 8.7      | 3.7 -> 6.4        | 3.56bb (2.8-4.5)     |
| 5        | 27.3 -> 35.8   | 18.8 -> 22.4  | 5.3 -> 9.9      | 2.9 -> 7.1        | 3.52bb (2.8-4.5)     |
| 4        | 32.5 -> 41.3   | 21.7 -> 26.6  | 6.5 -> 12.0     | 7.8 -> 9.6        | 3.41bb (2.8-4.5)     |
| 3        | 41.0 -> 48.9   | 26.8 -> 31.6  | 7.0 -> 12.9     | 7.5 -> 11.8       | 3.47bb (2.8-4.5)     |
| 2        | 60.2 -> 74.8   | 40.8 -> 48.2  | 9.1 -> 16.0     | -                 | 3.31bb (2.8-4.0)     |

Nine-handed, the seats behind an open go from 94.1 / 2.8 / 3.1 (fold / call /
3-bet) to 76.9 / 17.1 / 5.9, the small blind from 91.6 / 2.8 / 5.6 to 79.6 /
10.0 / 10.3, the big blind from 62.0 / 32.6 / 5.4 to 39.1 / 50.2 / 10.7, and
its fold to an open and a caller from 68.3 to 36.6. Heads-up the big blind's
fold falls from 56.3 to 27.2. At 100bb the nine-handed table reads 24.1 / 14.0
/ 6.7 with opens 2.5-4.3bb (mean 3.43).

Nine-handed lands at the bottom edge of the owner's 25-30% band offline. The
production number is the one that counts and is read after release with
`scripts/horse-measure/sql/cash-action-by-table-size.sql`.

## Measured: paired league (profit)

One hero with the profile on against the same deals with it off
(`server/scratch/league-v85.ts`, hybrid cash dials on both arms). No illegal
action and no truncated street in any card.

| card                                    | pairs  | bb/100 on minus off | std err |
| --------------------------------------- | ------ | ------------------- | ------- |
| human-calibrated field, 6-max 100bb, s1 | 40,000 | -0.18               | 5.50    |
| human-calibrated field, 6-max 100bb, s2 | 40,000 | -5.92               | 5.08    |
| human-calibrated field, 6-max 200bb, s1 | 40,000 | +12.00              | 8.82    |
| human-calibrated field, 6-max 200bb, s2 | 40,000 | -1.08               | 8.11    |
| human-calibrated field, 6-max 40bb      | 30,000 | -0.34               | 0.65    |
| horses on the prior ranges, 6-max 100bb | 20,000 | -2.91               | 1.98    |
| horses on the prior ranges, 6-max 40bb  | 20,000 | -0.27               | 0.35    |

No card declines by more than two standard errors, and none shows a gain: the
profile is not established as profitable or as costly. The horse-versus-horse
100bb card leans negative (about 1.5 standard errors), which is what a looser
caller among tighter players should cost, and it does not apply once every
seat plays the same profile. Two earlier candidates were rejected on this
league: the full widths with no depth taper ran -7.64 +/- 3.55 at 40bb, and
the larger open sizes alone at 40bb ran -1.64 +/- 0.95, which is why short
stacks keep the prior ranges and sizes. The league is six-handed; nine-handed
profit is not measured.

## Not done here

- Per-horse style spread (some loose, some tight). Every horse plays the one
  hybrid profile by owner direction of 2026-11-05, so it is not changed here.
- Postflop play is unchanged: the same postflop brain now plays wider ranges.
  The league above includes postflop play, but only six-handed.

## Regression protection

`server/src/engine/HorseCashAction.law.test.ts` (registry:
`docs/laws.d/server-src-engine-HorseCashAction.md`) fails the build if a full
table drops back under 23% VPIP nine-handed or 29% six-handed, if the 3-bet
falls under 5.5%, if the seats behind an open fold more than 81%, if seven- or
eight-handed tables fall off the profile, if the big blind folds more multiway
than heads-up to the open, if a cash open leaves 2.5-4.5bb, or if a 45bb table
stops deciding exactly as it did.

## Status

Source and tests only. Live requires the engine release that contains this
revision (04:00 America/Chicago window) and the production query above.
