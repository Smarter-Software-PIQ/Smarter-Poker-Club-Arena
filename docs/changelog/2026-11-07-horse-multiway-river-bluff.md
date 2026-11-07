# 2026-11-07 - Multiway river bluffs (Hold'em and PLO)

Owner instruction (Dan, 2026-11-06 20:52 Chicago): "MAKE SURE THAT YOU FULLY
UPGRADE ENHANCE, OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION
FOR BOTH HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING
THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR
QUALIFIED CANDITATES OR SITUATIONS."

#9803 (`HorseRiverBluffRange.ts`) owns the heads-up river. This change covers
the gap it left open: rivers with two or three opponents still in.

## Measured before the change (production, read-only)

`hand_history`, 24 hours to about 02:00 UTC 2026-11-07. Horse river decisions
with nothing to call (`publicNode.toCall = 0`, one board, no bomb pot),
grouped by the live seats in `publicNode.seats`. "Air" means no hole card
pairs the board, no pocket pair and no made flush; it is measured only on the
hands whose hole cards were recorded (mostly showdowns, so it leans toward
hands that got there).

| variant | live | spots  | bet % | air share of known bets | air bet rate |
| ------- | ---- | ------ | ----- | ----------------------- | ------------ |
| nlh     | 2    | 41,266 | 30.5  | 1,162 / 4,861 (23.9%)   | 12.7%        |
| nlh     | 3    | 1,837  | 14.4  | 16 / 109 (14.7%)        | 2.9%         |
| nlh     | 4+   | 221    | 6.3   | 4 / 10                  | 4.6%         |
| plo4    | 2    | 27,871 | 30.1  | 197 / 2,664 (7.4%)      | 11.3%        |
| plo4    | 3    | 3,213  | 15.5  | 11 / 200 (5.5%)         | 8.7%         |
| plo4    | 4+   | 724    | 9.3   | 0 / 24                  | 0 / 34       |
| plo5    | 3    | 860    | 19.9  | 2 / 81                  | 2 / 31       |
| plo5    | 4+   | 708    | 8.9   | 2 / 24                  | 2 / 13       |
| plo6    | 3    | 646    | 25.9  | 0 / 61                  | 0 / 5        |
| plo6    | 4+   | 781    | 12.5  | 1 / 36                  | 1 / 6        |

`horse_brain_telemetry`, three days: no multiway river bluff receipt exists
at all. The only river bluff fires are `v53_river_scare_bluff` (101) and
`v53_river_bluff` (72), both read-gated; `river_bluff_baseline_*` has not
reached production yet (it activates in a later 04:00 release).

In the engine (HorseLogic.decide, unknown opponents, 1/2 cash, 100bb, the
HorseV54RiverBluff fixture), EVERY three- and four-way air spot with a nut
blocker bet 0 of 200 seeds on every line: the baseline returns
`skip_multiway` and nothing below it bluffs a multiway river with no read.

## The poker

A multiway bluff must fold out everyone. If each opponent folds with
probability f, the bluff wins f^N and must beat s/(1+s) (one half at a pot
bet). Two uncapped opponents folding 60% each fold together 36%; three, 22%.
So a multiway bluff is only right when the folds are correlated - the whole
field capped by the line - and the bet represents a hand hero credibly holds
because hero removes it.

## What changed

`server/src/engine/HorseMultiwayRiverBluff.ts`, wired directly after the
heads-up baseline in HorseLogic's not-facing-a-bet river:

- Spot: 2 or 3 opponents, all able to respond, river checked to hero or hero
  first; the same domain exclusions as heads-up (fixed limit, short deck,
  multi-board, bomb pots, hi-lo with a low possible).
- Required: no showdown value (Hold'em no hole pair; Omaha at most one pair;
  equity against the field under 0.5 / (N + 1)), a nut blocker
  (`riverNutBlocker`), and a story that caps the field - the turn checked
  through, hero's delayed bet, hero's turn barrel every opponent flatted, the
  turn bettor checking with hero last, or a scare card hero blocks. Any
  opponent raise on the turn or river: no story.
- Frequency: the heads-up balanced share for the size x decay (0.45 with two
  opponents, 0.18 with three) x line (checked-through and delayed 1.0, barrel
  0.6, gave up 0.5, scare 0.7) x selection (blocker 1.0, blocker and missed
  draw 1.15) x 0.85 out of position x the PRODUCT of every opponent's read
  (any credible station: 0.05) x exploit bluffMod x ICM. Capped at 0.20 per
  combo three-way and 0.09 four-way.
- Size: no limit 0.75-1.0 pot, 1.0-1.25x on a scare card hero blocks, the
  shove when the deepest caller has at most 1.25 pots and there is no
  survival risk; pot limit 0.75-1.0 pot, never above it. A locked satellite
  seat never bluffs.
- `opts.riverBluffMultiway` (default on) ablates it. Ledger flag and
  `river_bluff_multiway_*` receipts (evaluated, selected_3way, selected_4way,
  check, illegal, skip_too_many, skip_cannot_respond, skip_no_blocker,
  skip_no_story); the module is in HorseReferenceDecisionSources so every
  phase digest moves with it.

## Measured after (HorseLogic.decide, unknown opponents, 200 seeds)

| spot (air with a blocker)                   | HU     | 3-way before / after | 4-way before / after |
| ------------------------------------------- | ------ | -------------------- | -------------------- |
| nlh 6-3 on 9-8-5-K-2, barrels called        | 40.5%  | 0 / 12.0%            | 0 / 4.0%             |
| nlh same, turn checked through              | 31.5%  | 0 / 16.0%            | 0 / 6.5%             |
| nlh Ah-3d on a three-heart river, barrels   | 30.5%  | 0 / 9.0%             | 0 / 3.0%             |
| nlh same, checked through                   | 20.0%  | 0 / 11.5%            | 0 / 10.0%            |
| plo4 As-Qh-4c-3d on Ks-9s-6d-2s-Jc, barrels | 20.5%  | 0 / 11.0%            | 0 / 4.5%             |
| plo4 same, checked through                  | 29.5%  | 0 / 16.5%            | 0 / 7.0%             |
| nlh junk / plo4 air without the ace         | 12-30% | 0 / 0                | 0 / 0                |
| nlh middle pair / plo4 top two              | -      | unchanged            | unchanged            |

## Pins

No existing pin's behaviour changes: the heads-up baseline law still sees
`skip_multiway` on its multiway spot (comment added naming the new owner).
New law `HorseMultiwayRiverBluff.law.test.ts` with
`docs/laws.d/horse-multiway-river-bluff.md`.

## Remaining gaps

- Five-way and wider rivers never bluff (deliberate).
- No league measurement or ablation of either river layer has been run.
- Out-of-position leads into a turn bettor, fixed limit, short deck,
  multi-board, bomb pots and hi-lo with a low possible are still excluded.

## Activation

Engine change: it activates only in the next certified 04:00-04:05
America/Chicago maintenance release. Not live before then.
