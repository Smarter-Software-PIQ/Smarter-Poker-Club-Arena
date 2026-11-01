# V71: ante-aware push/fold for the Hold'em folded-to jam (2026-10-31)

Dan, 2026-10-31: "AUDIT AND IMPROVE THE HORSES OPENING RANGES IN BOTH
TOURNAMENTS AND CASH GAMES ... BASED ON GTO ... MAKE ANY AND ALL IMPROVEMENTS,
AND MAKE SURE THEY ARE FULLY ACTIVATED AND LIVE". This is V70 follow-up 2
(`docs/changelog/2026-10-31-v70-gto-opening-ranges.md`).

Option: `v71AnteAwarePushFold` (default on, explicit `false` keeps today's
answer), registered in `HorseDataLedger.ts` with the `v71_ante_push` receipt
(every V71 answer is still also counted in `v27_gto_open_jam`, so that
receipt's ratio floor keeps its meaning).

## The defect, read from the rows

`memory_charts_gold` (read-only, 2026-10-31): every `fold_to_hero` Tournament
cell equals its Cash cell. Combo-weighted jam %:

| depth | UTG  | MP   | CO   | BTN  | SB   |
| ----- | ---- | ---- | ---- | ---- | ---- |
| 15bb  | 10.5 | 13.7 | 18.6 | 26.6 | 45.6 |
| 12bb  | 13.3 | 16.4 | 22.5 | 31.4 | 53.2 |
| 10bb  | 15.2 | 19.5 | 24.8 | 32.4 | 58.3 |
| 8bb   | 18.5 | 22.2 | 28.5 | 34.2 | 61.9 |
| 5bb   | 24.6 | 29.4 | 32.7 | 40.7 | 71.5 |

These are the no-ante six-handed game (the SB column is the heads-up Nash
small blind exactly: 58.3% at 10bb). Three consequences in `HorseLogic` V27
CASE A:

1. **The ante is ignored.** NLH MTTs here play a big-blind ante equal to the
   big blind from level 5, so the pot a folded-to jam wins is 2.5bb, not
   1.5bb; the jam ranges that price it are much wider.
2. **Five positions.** `classifyPosition` buckets put the nine-handed UTG,
   UTG+1 and UTG+2 on the six-handed UTG chart (five behind) and LJ/HJ on MP.
3. **The offline fallback** (charts not hydrated: boot race, load failure,
   every league and audit run) jammed on the old strength ladder: at 15bb
   with a big-blind ante the button, small blind and HJ all jammed ~21%, and
   the heads-up small blind 37% at every depth from 15bb to 8bb.

## The fix (root)

`server/src/engine/HorseAnteAwarePushFold.ts` + `HorseNashPushFold.data.ts` (the
generated table as a TypeScript module: the engine image emits with
`noResolve` and lists its JSON resources explicitly, so a JSON import
would not ship).

- **The table is computed, not tuned.** `server/scripts/nash-push-fold/`:
  `equity169.c` computes the all-in preflop equity of every 169-class pair
  (100,000 boards per class pair, every card-compatible combo pair equally
  weighted, fixed seeds; 2 minutes; output sha256
  `fcf5a3cd8736b53ea2f31578f09323917b16d36b3833405528d8ba713987719e`), and
  `solve.py` solves the chip-EV Nash equilibrium of the jam-or-fold game by
  averaged best response (600 rounds) for every seat count 1..8 players
  behind and dead ante A = 0, 1, 2bb on a 0.5bb grid 1.5..25bb. Model: the
  standard "jam or fold, first caller only" game of the classic Nash
  push/fold charts (HoldemResources Calculator chip-EV, the Sklansky-Chubukov /
  "Nash push-fold" tables); every stack is S including its posted blind,
  antes are dead money, a caller's call closes the action, card removal
  between hero and each caller is exact, callers are independent. Data module
  sha256 `ed1c8e7db181c83ed1269589201e8c52a7cc10eb12947a54971f5ca34afc5416` (after `prettier --write`).
- **Validation:** with A = 0 the table reproduces the solver charts it
  replaces: SB 10bb 58.4 (chart 58.3), SB 15bb 45.7 (45.6), BTN 15bb 27.3
  (26.6), CO 15bb 18.3 (18.6), MP 15bb 13.1 (13.7), UTG 10bb 13.4 (15.2).
  The first-caller-only model runs slightly tight at the earliest seats
  (an early caller ignores the overcallers behind him, so he calls a little
  wide), which is the known direction of that approximation.
- **Form:** each hand carries "jams up to X bb" (the classic chart form).
  Between grid points the jam is mixed linearly across the half-blind gap;
  between ante levels the threshold is interpolated (`anteOrbitCostBB`: a
  big-blind ante is its total, a per-player ante is ante x dealt).
- **Seat** = dealt-in players still to act behind (V70's
  `preflopPlayersBehind`): SB 1, BTN 2 ... nine-handed UTG 8, heads-up SB 1.
- **Depth** = hero's (stack + posted blind), capped by the deepest live stack
  still to act. The gate stays hero <= 15bb (V27's zone).
- **Scope:** folded-to, unopened, unlimped, no straddle, two-card NLH (not
  short deck, not fixed limit), a tournament or an ante cash table, AND dead
  ante in the pot. It answers whether or not the charts hydrated, so live and
  offline read the same table. V48 persona adherence is honoured exactly as
  for the chart. Nothing reads who anyone is (pinned: an all-human table gets
  the jams an all-horse table gets).
- **Unchanged:** an ante-free pot (charts live, old fallback offline; see the
  league), the 16-22bb orange-zone shove (owner decision pending), the BB's
  call-off against a small-blind jam, every deeper stack, cash without an
  ante, Omaha.

## Before / after (balanced, 20 seeds per class, end to end through `HorseLogic.decide`)

Each cell: **live today** (the chart for the seat's bucket, ante ignored) /
**offline fallback today** (the audit, charts not hydrated) / **V71**. No-ante
rows are unchanged by V71. `server/scratch/rfi-audit.ts ctx=pf...` (`off71`
for the off arm).

#### 9-handed (combo-weighted jam %, folded to the seat; live chart / offline fallback / V71)

| depth | ante | UTG                     | UTG1                    | UTG2                    | LJ                      | HJ                      | CO                      | BTN                     | SB                            |
| ----- | ---- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------------- |
| 15bb  | BBA  | 10.5 / 14.6 / **8.6**   | 10.5 / 14.7 / **10.9**  | 10.5 / 14.2 / **13.1**  | 13.7 / 14.5 / **16.3**  | 13.7 / 15.3 / **22.8**  | 18.6 / 21.0 / **28.8**  | 26.6 / 20.8 / **35.7**  | 45.6 / 20.8 / **63.8**        |
| 15bb  | none | 10.5 / 9.5 (unchanged)  | 10.5 / 9.3 (unchanged)  | 10.5 / 9.3 (unchanged)  | 13.7 / 17.1 (unchanged) | 13.7 / 17.5 (unchanged) | 18.6 / 22.0 (unchanged) | 26.6 / 38.5 (unchanged) | 45.6 / 31.5+L14.3 (unchanged) |
| 12bb  | BBA  | 13.3 / 18.3 / **10.9**  | 13.3 / 18.3 / **13.1**  | 13.3 / 18.2 / **15.1**  | 16.4 / 18.4 / **20.4**  | 16.4 / 18.8 / **25.8**  | 22.5 / 25.0 / **31.5**  | 31.4 / 24.7 / **37.6**  | 53.2 / 24.8 / **70.1**        |
| 12bb  | none | 13.3 / 11.8 (unchanged) | 13.3 / 11.7 (unchanged) | 13.3 / 11.6 (unchanged) | 16.4 / 11.8 (unchanged) | 16.4 / 12.0 (unchanged) | 22.5 / 18.3 (unchanged) | 31.4 / 18.4 (unchanged) | 53.2 / 18.2 (unchanged)       |
| 10bb  | BBA  | 15.2 / 18.3 / **14.3**  | 15.2 / 18.3 / **15.1**  | 15.2 / 18.2 / **18.6**  | 19.5 / 18.4 / **22.5**  | 19.5 / 18.8 / **29.4**  | 24.8 / 25.0 / **33.0**  | 32.4 / 24.7 / **42.4**  | 58.3 / 24.8 / **73.2**        |
| 10bb  | none | 15.2 / 11.8 (unchanged) | 15.2 / 11.7 (unchanged) | 15.2 / 11.6 (unchanged) | 19.5 / 11.8 (unchanged) | 19.5 / 12.0 (unchanged) | 24.8 / 18.3 (unchanged) | 32.4 / 18.4 (unchanged) | 58.3 / 18.2 (unchanged)       |
| 8bb   | BBA  | 18.5 / 20.9 / **18.3**  | 18.5 / 20.8 / **20.4**  | 18.5 / 20.9 / **22.8**  | 22.2 / 20.9 / **27.3**  | 22.2 / 21.2 / **31.2**  | 28.5 / 33.5 / **35.1**  | 34.2 / 33.3 / **46.6**  | 61.9 / 33.4 / **77.1**        |
| 8bb   | none | 18.5 / 14.6 (unchanged) | 18.5 / 14.7 (unchanged) | 18.5 / 14.2 (unchanged) | 22.2 / 14.5 (unchanged) | 22.2 / 15.3 (unchanged) | 28.5 / 21.0 (unchanged) | 34.2 / 20.8 (unchanged) | 61.9 / 20.8 (unchanged)       |
| 5bb   | BBA  | 24.6 / 24.7 / **42.4**  | 24.6 / 24.8 / **42.7**  | 24.6 / 24.4 / **43.0**  | 29.4 / 24.8 / **45.4**  | 29.4 / 25.9 / **46.0**  | 32.7 / 38.5 / **49.6**  | 40.7 / 38.5 / **57.8**  | 71.5 / 38.4 / **85.8**        |
| 5bb   | none | 24.6 / 18.3 (unchanged) | 24.6 / 18.3 (unchanged) | 24.6 / 18.2 (unchanged) | 29.4 / 18.4 (unchanged) | 29.4 / 18.8 (unchanged) | 32.7 / 25.0 (unchanged) | 40.7 / 24.7 (unchanged) | 71.5 / 33.4 (unchanged)       |

#### 6-handed (combo-weighted jam %, folded to the seat; live chart / offline fallback / V71)

| depth | ante | UTG                     | HJ                      | CO                      | BTN                     | SB                      |
| ----- | ---- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| 15bb  | BBA  | 10.5 / 18.3 / **16.3**  | 13.7 / 18.3 / **22.8**  | 18.6 / 24.4 / **28.8**  | 26.6 / 24.8 / **35.7**  | 45.6 / 25.9 / **63.8**  |
| 15bb  | none | 10.5 / 11.8 (unchanged) | 13.7 / 17.1 (unchanged) | 18.6 / 21.7 (unchanged) | 26.6 / 38.5 (unchanged) | 45.6 / 18.8 (unchanged) |
| 12bb  | BBA  | 13.3 / 20.9 / **20.4**  | 16.4 / 20.8 / **25.8**  | 22.5 / 32.7 / **31.5**  | 31.4 / 33.4 / **37.6**  | 53.2 / 34.8 / **70.1**  |
| 12bb  | none | 13.3 / 14.6 (unchanged) | 16.4 / 14.7 (unchanged) | 22.5 / 20.9 (unchanged) | 31.4 / 20.9 (unchanged) | 53.2 / 21.2 (unchanged) |
| 10bb  | BBA  | 15.2 / 20.9 / **22.5**  | 19.5 / 20.8 / **29.4**  | 24.8 / 32.7 / **33.0**  | 32.4 / 33.4 / **42.4**  | 58.3 / 34.8 / **73.2**  |
| 10bb  | none | 15.2 / 14.6 (unchanged) | 19.5 / 14.7 (unchanged) | 24.8 / 20.9 (unchanged) | 32.4 / 20.9 (unchanged) | 58.3 / 21.2 (unchanged) |
| 8bb   | BBA  | 18.5 / 20.9 / **27.3**  | 22.2 / 20.8 / **31.2**  | 28.5 / 32.7 / **35.1**  | 34.2 / 33.4 / **46.6**  | 61.9 / 34.8 / **77.1**  |
| 8bb   | none | 18.5 / 14.6 (unchanged) | 22.2 / 14.7 (unchanged) | 28.5 / 20.9 (unchanged) | 34.2 / 20.9 (unchanged) | 61.9 / 21.2 (unchanged) |
| 5bb   | BBA  | 24.6 / 24.7 / **45.4**  | 29.4 / 24.8 / **46.0**  | 32.7 / 38.3 / **49.6**  | 40.7 / 38.5 / **57.8**  | 71.5 / 39.0 / **85.8**  |
| 5bb   | none | 24.6 / 20.9 (unchanged) | 29.4 / 20.8 (unchanged) | 32.7 / 32.7 (unchanged) | 40.7 / 33.4 (unchanged) | 71.5 / 34.8 (unchanged) |

#### 3-handed (combo-weighted jam %, folded to the seat; live chart / offline fallback / V71)

| depth | ante | BTN                     | SB                      |
| ----- | ---- | ----------------------- | ----------------------- |
| 15bb  | BBA  | 26.6 / 33.3 / **35.7**  | 45.6 / 33.3 / **63.8**  |
| 15bb  | none | 26.6 / 20.9 (unchanged) | 45.6 / 24.8 (unchanged) |
| 12bb  | BBA  | 31.4 / 33.3 / **37.6**  | 53.2 / 33.3 / **70.1**  |
| 12bb  | none | 31.4 / 24.7 (unchanged) | 53.2 / 24.8 (unchanged) |
| 10bb  | BBA  | 32.4 / 33.3 / **42.4**  | 58.3 / 33.3 / **73.2**  |
| 10bb  | none | 32.4 / 24.7 (unchanged) | 58.3 / 24.8 (unchanged) |
| 8bb   | BBA  | 34.2 / 33.3 / **46.6**  | 61.9 / 33.3 / **77.1**  |
| 8bb   | none | 34.2 / 24.7 (unchanged) | 61.9 / 24.8 (unchanged) |
| 5bb   | BBA  | 40.7 / 38.3 / **57.8**  | 71.5 / 38.4 / **85.8**  |
| 5bb   | none | 40.7 / 33.3 (unchanged) | 71.5 / 33.3 (unchanged) |

#### 2-handed (combo-weighted jam %, folded to the seat; live chart / offline fallback / V71)

| depth | ante | SB                      |
| ----- | ---- | ----------------------- |
| 15bb  | BBA  | 45.6 / 37.1 / **63.8**  |
| 15bb  | none | 45.6 / 29.6 (unchanged) |
| 12bb  | BBA  | 53.2 / 37.1 / **70.1**  |
| 12bb  | none | 53.2 / 29.6 (unchanged) |
| 10bb  | BBA  | 58.3 / 37.1 / **73.2**  |
| 10bb  | none | 58.3 / 29.6 (unchanged) |
| 8bb   | BBA  | 61.9 / 37.1 / **77.1**  |
| 8bb   | none | 61.9 / 29.6 (unchanged) |
| 5bb   | BBA  | 71.5 / 40.5 / **85.8**  |
| 5bb   | none | 71.5 / 37.1 (unchanged) |

Reading the 9-handed 15bb big-blind-ante row: UTG goes from the six-handed
UTG chart (10.5) to 8.6 because eight players are behind it, not five; every
seat from UTG+2 on jams wider, the button 26.6 -> 35.7 and the small blind
45.6 -> 63.8. At 5bb with the ante 2.5bb is half the stack, and even UTG jams
42%.

## League (paired deals, 6000 pairs, a = on, b = `{ v71AnteAwarePushFold: false }`)

`server/scratch/league-v71.ts` (MTT six-handed, 180 left / 30 paid). The
league now posts a big-blind ante when a card asks for one (`bigBlindAnte` on
`LeagueGameContext`; before V71 no card posted any ante, so an ante card
would have priced dead money that was not in the pot). Off arm, offline
(fallback):

| card      | mirror bb/100 (seed 71 / 72)    | divergent   | human field bb/100 (seeds 71-74)                                                     | divergent |
| --------- | ------------------------------- | ----------- | ------------------------------------------------------------------------------------ | --------- |
| 15bb BBA  | +5.10 +/- 0.76 / +4.66 +/- 0.73 | 1442 / 1400 | +3.67 +/- 3.60, +0.68 +/- 4.24, +2.24 +/- 3.55, +0.60 +/- 3.95 (mean +1.80 +/- 1.92) | ~210      |
| 10bb BBA  | +4.02 +/- 0.58 / +4.35 +/- 0.58 | 1305 / 1324 | +2.50 +/- 2.75, +2.54 +/- 3.09, +3.79 +/- 2.95, +7.05 +/- 2.97 (mean +3.97 +/- 1.47) | ~250      |
| 15bb none | inert                           | 0           | inert                                                                                | 0         |
| 10bb none | inert                           | 0           | inert                                                                                | 0         |

Off arm LIVE-EQUIVALENT (`league-v71-charts.ts`: the fold_to_hero charts
hydrated, emulated from the no-ante table, which matches the charted widths
within 1.8 points, so arm b plays what production plays today):

| card     | mirror bb/100 (seed 71 / 72)    | human field bb/100 (seeds 71-74)                                                     |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| 15bb BBA | +5.75 +/- 0.75 / +4.72 +/- 0.77 | +1.36 +/- 4.20, +6.11 +/- 4.71, -2.44 +/- 3.94, +3.28 +/- 4.25 (mean +2.08 +/- 2.14) |
| 10bb BBA | +4.72 +/- 0.54 / +5.23 +/- 0.59 | +2.62 +/- 2.87, +4.70 +/- 3.45, +3.29 +/- 2.99, +4.00 +/- 3.16 (mean +3.65 +/- 1.56) |

**Adjusted before shipping.** The first build answered ante-free pots from
the A = 0 table too. Against the human-calibrated field the no-ante 15bb card
ran -3.66 +/- 3.21, **-7.61 +/- 3.69** (seed 2026103172, below -2 stderr),
+0.37 +/- 3.10, -3.33 +/- 2.96 (mean -3.56 +/- 1.63) and 10bb -1.44 / -5.13 /
+0.41 / +0.40 (mean -1.44 +/- 1.18), while its mirror cards were positive
(+0.72 / +1.31 at 15bb, +3.51 / +2.39 at 10bb). Live, an ante-free pot is
already answered by the charts, which are the no-ante game, so V71 is now
gated on dead ante in the pot and both no-ante cards are inert. No shipped
card is below -2 stderr.

## Tests

- `server/src/engine/HorseAnteAwarePushFold.test.ts` (new): the table
  reproduces the no-ante charts; the ante widens every seat at every depth
  5-15bb and fewer players behind always jams wider; premiums always jam,
  72o never jams with eight behind; ante interpolation and the half-blind
  mix; end to end 9-handed 15bb BBA per-seat bands (UTG 7-10.5, LJ 14.5-18.5,
  HJ 20.5-25, CO 26.5-31, BTN 33.5-38.5, SB 58-68); ante-free pots identical
  on and off; the off arm keeps the old fallback; heads-up 10bb BBA SB
  69-77%; a 16bb stack and a no-ante 12bb cash stack identical on and off;
  an all-human table gets the same jams as an all-horse table.
- `HorseAxisSweep.test.ts`: the "chart owns the push/fold zone" pin runs on
  an ante-free pot (still the chart's on either arm); a new pin shows a
  big-blind-ante pot is answered by the table, not a hand-made chart row.
- `HorseMultiwayMzone.test.ts`: the V20 ablation ("the jam is the LAYER")
  isolates the layer with V71 off, since an ante pot at 14bb now jams from
  the table as it always did from the chart when hydrated.
- Off arms in `HorseOpponentExploitNeutrality.test-support.ts` and
  `HorseOmahaTournamentPressureCorpus.test-support.ts` (as V70).
- `HorseReferenceDecisionSources.ts` names the module and its data file.

## Follow-ups (reported, not changed)

1. **The ante-free offline fallback is still the strength ladder** (heads-up
   SB jams 29.6% at 8-15bb, 6-handed SB ~19-21%). Live it is never reached
   while the charts hydrate; the measured Nash replacement lost to the human
   field at 15bb (above), so changing it needs that population question
   answered.
2. **BB call-off against a small-blind jam** (`sb_push` charts) is the
   no-ante game too; with the ante the small blind now jams wider and the BB
   should call wider. Not part of the opening range.
3. **ICM.** The table is chip-EV, as the charts were; the ICM premium does
   not tighten the folded-to jam (unchanged from the charts).
4. Orange-zone shove 16-22bb (V70 follow-up 1, owner decision pending).
