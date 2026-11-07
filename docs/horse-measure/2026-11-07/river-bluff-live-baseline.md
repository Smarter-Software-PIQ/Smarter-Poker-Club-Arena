# River bluff live report: the pre-release baseline (2026-11-07)

Measured with `scripts/horse-measure/river-bluff-ev.ts` (read-only) before any
of #9803, #9837, #9838 or #9842 served. At 13:00 UTC the serving engine was
`92e26a9f`; `river-bluff-ev.ts window` answered NOT_RELEASED (exit 4): it does
not contain `57d9c627`. Raw results and the rendered reports are in
`river-bluff-live-baseline/`.

## Window and statements

- Spots: `[2026-11-07T06:00:00Z, 2026-11-07T08:00:00Z)`, one statement, about
  20 s through the management API (`read_only: true`).
- Receipts: UTC days 2026-11-05 to 2026-11-07.

```bash
cd server
npx tsx ../scripts/horse-measure/river-bluff-ev.ts sql spots 2026-11-07T06:00:00Z 2026-11-07T08:00:00Z
npx tsx ../scripts/horse-measure/river-bluff-ev.ts sql receipts 2026-11-05 2026-11-07
npx tsx ../scripts/horse-measure/river-bluff-ev.ts assemble 2026-11-07T06:00:00Z 2026-11-07T08:00:00Z \
  ../docs/horse-measure/2026-11-07/river-bluff-live-baseline/spots-2026-11-07T0600Z_0800Z.json \
  ../docs/horse-measure/2026-11-07/river-bluff-live-baseline/receipts-2026-11-05_2026-11-07.json
```

## The baseline reproduces exactly

| variant | captured baseline  | this tool             |
| ------- | ------------------ | --------------------- |
| nlh     | 29.5% bet of 4,328 | 29.5% (1,278 / 4,328) |
| plo4    | 27.0% of 3,453     | 27.0% (934 / 3,453)   |
| plo6    | 33.2% of 268       | 33.2% (89 / 268)      |
| plo5    | 31.7% of 164       | 31.7% (52 / 164)      |
| flo8    | 18.2% of 22        | 18.2% (4 / 22)        |

(flh 3 spots; no short deck, bomb pot or multi-board river decision in the window.)

## What the old engine does (the "before" side)

- Air share of bets: nlh 21.0% +/- 1.1 (269 / 1,278), plo4 5.5% +/- 0.7,
  plo5 3.8%, plo6 1.1%. Air bets 16.7% of nlh air spots, 15.3% of plo4.
- Heads-up vs multiway bet frequency: nlh 30.3% vs 14.6%, plo4 29.2% vs
  14.5%; multiway air bets are rare (nlh 5 of 108 air spots, plo4 1 of 53):
  the gap #9842 targets.
- Line: nlh heads-up checked to 41.4% bet, first to act 21.6%; plo4 34.0% vs
  25.5%.
- The bluffs that do happen are over-folded. nlh air bets: fold 59.1% +/- 3.0
  against a 33.6% break-even at 0.61 pot, decision EV +17.62 +/- 3.29 bb
  (n 269); plo4: fold 80.4% +/- 5.6 against 39.3%, +11.29 +/- 3.39 bb (n 51).
  Against public-stat stations the fold rate holds (62.7%, n 51) at a larger
  size (0.90 pot) and a smaller EV (+6.85 +/- 1.83). These are the rates the
  new layers will be judged against; by TUNING.md section 3 every one is below
  the 200-bluff threshold for a tune.
- Opponent kind (data identification only): 7,422 heads-up spots against
  horses, 5 against people; multiway 811, all-horse. Human-opponent cells will
  need days, not hours.

## Receipts: zero is zero, silence is NO DATA

Controls flowed every day (decide*nlh 1,201,263 / 1,152,543 / 870,741 on
11-05 / 11-06 / 11-07), so every new layer's receipt reads ZERO, not NO DATA:
`river_bluff_baseline*_`, `river*bluff_multiway_selected*_`,
`river*lead_bluff*_`, `river*bluff_hilo*_`and`v54_river_bluff`all 0.
V53 fired:`v53_river_bluff`45 / 16 / 12 and`v53_river_scare_bluff`
65 / 20 / 17 (the 11-07 counts were 11 and 16 at the 08:20 UTC capture).
The report flags the case itself: "No receipt of the new river bluff layers
fired on any live day".

Two checks of the honest-zero rule, kept as `report-no-data.md`:

- A spots slice with no rows (2026-11-09 10:05-12:05 UTC, not yet played)
  renders `## NO DATA ... This is not a zero` and exits 3.
- Receipts for a day whose controls never fired print `-` and NO_DATA for every
  layer, never a 0 count.
- Assembling 06:00-10:00 from only the 06:00-08:00 slice reports
  `COVERAGE INCOMPLETE: gaps [08:00, 10:00)` and exits 3.

## After the release

Run `window` the day after a certified 04:00 America/Chicago release that
contains `57d9c627`; it gives START. Then `plan START END 2`, run every
statement, `assemble`, and read the result with `scripts/horse-measure/TUNING.md`.
