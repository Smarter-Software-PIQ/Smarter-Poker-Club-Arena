# The big blind is swept across depth and price; heads-up rules have a stated scope (HU-NLH-001 Phase 2)

Date: 2026-11-13

Tests only. No engine source, no default and no league card changes.

## Why

HU-NLH-001 was a step at exactly 50bb. Heads-up, the cash big blind folds
58.7% to a 2bb, 2.5bb, 3bb or 4bb open alike from 15bb to 50bb, and 39.6% to a
2bb open at 52bb (19.9% at 80bb). V85 widens the cash big blind above
`V85_DEPTH_NONE_BB` only, and a table with two dealt in never reaches the
per-seat defence that three or more get. Reproduced on main `4c351cfc` through
the real `HorseLogic.decide` with the live cash Hybrid persona and live
default flags. Nothing looked across depth and price together, so it shipped.

## What

`server/src/engine/HorseBigBlindDepthPriceSweep.law.test.ts` sweeps 2, 3 and 6
dealt, fifteen depths from 15bb to 150bb and opens of 2, 2.5, 3 and 4bb:

1. the fold share never falls as the open grows (equal allowed, 1.5 points of
   sampling tolerance);
2. between neighbouring depths it moves at most 2.5 points per big blind,
   except at a boundary named with the constant that causes it;
3. a depth where a 4bb open is folded to no more than a 2bb open must be named.

The two lists hold today's open defect and nothing else: the 50-52bb step with
two dealt, and two dealt at 15-50bb. They may only shrink. An entry that stops
reproducing fails the law until it is removed, so the fix deletes its own
exemption. The law pins no frequency.

The candidate `huBbDefendsToPrice` (default OFF, not promoted) is held to its
own contract: price-sensitive from 20bb to 50bb, widen-only, and identical to
live at 15bb.

`server/src/engine/HorseHeadsUpRuleScope.law.test.ts` states where each
heads-up-only rule fires:

- `huBbDefendsToPrice`: exactly two dealt in. Two dealt at a six-seat table is
  a heads-up hand and fires. Blind against blind after a dealt-in button
  folded does not (a different opening range). Not in a tournament, below
  20bb, or against an open above 6bb.
- `commitUnderPot`: no third player still in the hand. A third player who is
  all in blocks it; one who folded does not.

## Measured, not changed here

With `huBbDefendsToPrice` on, the heads-up big blind folds 0.0% to a 2bb open
from 20bb up, 21.4% to 2.5bb and 39.4% to 3bb. Whether that is too wide
against a tight opener is being measured before any default changes.

## Tests

Both files pass on `4c351cfc` (12 tests, about 6 seconds together). Emptying
either exemption list makes the sweep fail, which is the reproduction of
HU-NLH-001.
