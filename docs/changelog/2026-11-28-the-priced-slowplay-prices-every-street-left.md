# The Priced Slowplay Prices Every Street Left

2026-11-28, HORSE DECISIONS lane. Option `horseSlowplayIsPriced` (Hold'em, dark, default OFF, never switched on by this lane). Backlog item 3 of the lane handoff, after the option failed its first honest grade.

## What Was Wrong

The option replaces the blanket coin flip that makes a Horse check a monster hand some of the time. It decided by pricing a bet against a check, but it priced **one street**: bet now (the opponent folds, or calls once) against check now (the opponent stabs once, or nothing happens). Graded on 2026-11-28 with the grading harness against a bar declared in advance, it netted +0.08 +/- 0.49 bb per 100 hands, which is zero, and its whole gain came from one opponent profile that never folds (heads-up +29.06 +/- 5.37). Against opponents who can fold it was worth nothing.

Two inputs were also off. The size it assumed for an opponent's stab (0.5009 of the pot on the flop, 0.6185 on the turn) was measured on a sample that was 99.85% Horse bets, and it took the mean first and applied the stack cap second.

## Why

A slowplay is a trade across streets. A check gives up a bet now to win bets later: the bets it draws on this street and the next ones, and the value bet the Horse can still make. A bet wins a fold now or builds the pot that every later bet is sized from. A comparison that stops at the end of the current street sees the fold and the single stab and nothing else, so it nearly always says "bet", and the option reduced to "stop the coin flip". That is only worth chips against someone who calls everything.

The doc carried this as limitation S6, "one street only"; S3 and S4 were the stab size.

## The Fix

`server/src/engine/HorseSlowplayPriced.ts` now walks a small explicit tree from the decision street to the river (three streets on the flop, two on the turn, at most 125 closed-form nodes):

- At each street the opponents who act before the Horse may lead; otherwise the Horse takes the better of a bet and a check. A bet is folded to, called or raised. A check is bet into or checked through. Then the next street, with the pot and the stacks as that line left them. After the river the hand is shown down.
- Equity is conserved over every opponent choice: the range that calls or bets is stronger, the range that folds or checks is weaker by exactly as much.
- Every input is measured from real people (production hand history, Hold'em, hands with a person in them, 2026-10-19 to 2026-11-28, Horse actions excluded): how often a person bets into an unbet pot (by street, by who bet last on the street before, and by first to act or checked to; 18 cells, the smallest n 196 from 51 people), the size of that bet (flop n 2,035 from 78 people, turn 1,425 from 73, river 1,000 from 76; pinned as 20 quantiles, each capped by the stack before the mean), and how often and how big a person raises a bet (flop 324 raises, turn 163, river 79).
- Where nothing is measured the pricing leans to the bet, never to the check: the Horse only ever calls an opponent's bet in the tree, an opponent's bet is priced as the strongest part of its range, an opponent's own record can lower the later streets' betting rates but never raise them, and a wet board is never checked.
- The call site in `HorseLogic.ts` adds one read: who bet last on the street before, from the public action history. With the option off nothing is entered and every decision is byte-identical.

Cost: the widest tree is about 30 microseconds; the applicable decision with the option on costs 1.08 to 1.17 times the same decision with it off.

## The Honest Re-Grade

Bar declared before any harness run of the rebuilt code: `CRITERIA-SLOWPLAY2-01Gw7aDq.md`, sha256 `fdbc9d0fd9a2317615d7e74f33de57bb8c16eb7183b45972c4c9c9c710986e01`. Same harness and commands as the first grade (`server/scripts/horse-grade.ts`, base = the 80 live switch rows, 6,000 pairs or deals a cell, heads-up and 6-max at 100 bb), with seeds 7 and 42 added for every opponent profile (30 cells, was 14) and one rule added: the pooled gain must also hold with the never-folding profile left out.

Every one of the 30 cells was clean (0 illegal, 0 truncated, 0 no-op divergence) and the option changed play in all of them.

| Opponent Profile                      | Result, bb per 100 hands |
| ------------------------------------- | ------------------------ |
| Mirror (Horses on both sides)         | -0.72 +/- 0.59           |
| Nobluff (bets value only)             | -0.14 +/- 1.25           |
| Balanced                              | +0.40 +/- 1.19           |
| Overbluff                             | -0.40 +/- 1.30           |
| Caller (calls every bet, never folds) | +12.87 +/- 1.65          |
| **Pooled, all 30 cells**              | **+0.51 +/- 0.44**       |
| **Pooled, caller left out**           | **-0.44 +/- 0.46**       |

**FAIL.** The pooled result is not two standard errors above zero (z +1.15), and with the never-folding profile left out it is -0.44 +/- 0.46. The gain still exists only against an opponent who never folds. No cell was harmed beyond two standard errors (the lowest is z -1.62); at 6-max with the caller left out the result leans negative (-1.01 +/- 0.53).

On the 14 cells both versions were graded on, the code on main scored +0.08 +/- 0.49 (caller left out -0.33 +/- 0.50) and this change +0.45 +/- 0.52 (caller left out +0.01 +/- 0.53): higher on both, by less than one standard error. The harness does not tell them apart, and a diagnostic run shows why: in the mirror the new verdict was a check 0 times in 123 heads-up and 5 times in 129 at 6-max. No harness opponent has the record that makes the new pricing check (folds to most bets, bets when checked to), so the harness again measured the removal of the coin flip and not what the every-street pricing adds.

The rule for pushing a failed rebuild was also declared in advance (clean, no harmed cell, no mixed sign, and not below the code on main on the 14 shared cells, with or without the caller). It is met, so the rebuild is pushed dark.

## Pinned By

- `server/src/engine/AHorseSlowplayIsPriced.law.test.ts`: 30 tests. Eleven are new for this change and all eleven fail on the old code (13 fail in total, with two older tests whose claims changed): the people-measured inputs and their provenance; the bet size from capped quantiles; equity conserved over an opponent's bet; one street priced equals the closed form; every street priced changes the verdict (a check against an opponent who folds three bets in four, a bigger lead for the bet against one who does not fold); the stab rate by who bet last; the lean to the bet (wet board, an opponent's record on later streets); the node bound; the pricer reachable only behind the option read `=== true`; the relative cost; and the call site end to end.
- `docs/laws.d/server-src-engine-AHorseSlowplayIsPriced.md`, `docs/horse-option-authority.d/horseSlowplayIsPriced.UNREGISTERED.md` (measured inputs with n and people, the limitations that closed and the ones that remain, the grade).

## What This Does Not Do

It does not switch anything on. The option stays default OFF and refused by the switch. Its harness bar is failed and its people bar (20 or more changed decisions against real people on real hands) is not met: the last replay had one, and no people-only replay of the rebuilt pricing has been run. The two things that would move it are that replay, and a harness opponent that folds and stabs at the rates measured from people.
