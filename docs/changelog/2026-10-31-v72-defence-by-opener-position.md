# V72: Hold'em defence facing one open reads the opener's seat (2026-10-31)

Dan, 2026-10-31: "LETS GET THIS MOVING ONTO THE NEXT PHASES ... AUDIT AND
IMPROVE ... BASED ON GTO".

Option: `v72DefenceByOpener` (default on, explicit `false` keeps today's
defence), registered in `HorseDataLedger.ts` with the `v72_defend_vs_opener`
receipt. Module: `server/src/engine/HorseGtoDefenceRanges.ts`.

This is follow-up 3 of V70 (`2026-10-31-v70-gto-opening-ranges.md`). V70
fixed the open. This change fixes the answer to the open.

## Root cause (probe first, not a guess)

V70's follow-up measured the big blind against a button open and against an
under-the-gun open (cash 6-max 100bb, 2.5x) and got the same answer to the
decimal both times: call 35.7%, 3-bet 10.5%. A probe (a temporary, uncommitted log of the preflop context in the
single-raise branch, plus `CENSUS=1` on `server/scratch/defend-probe.ts`)
showed two separate causes.

1. **The probe fixture, not production.** The fixture had no dealt census
   (`dealtSeatIds`) and gave folded seats no cards. Without a census,
   `dealtSeatOrder` counts a seat as dealt only if it has cards, chips in or
   is still live, so the two folded middle seats dropped out of the ring. That
   left `[SB, BB, UTG, BTN]`, and under-the-gun was classed `late`. The V32
   facing-defence layer was not involved: it is postflop only, and the
   preflop telemetry showed `preflop_v7` answering every decision. The live
   engine always sends the census (`ServerTableEngineTurns.ts`, `dealtSeatIds`
   on every schema-1 snapshot), so live seats were classed correctly. With
   the census added, the same fixture gave BB vs UTG call 31.8 / 3-bet 6.3.
2. **The production defect: a five-bucket defence.** With the census set,
   the big blind's continue width came from the V34 floor (`0.22` against a
   `late` raiser, `0.30` against anything else). That floor sits below
   `CALL_VS` for every bucket, so it is the number that actually decides.
   The result: BB vs UTG = BB vs HJ = 38.8% and BB vs CO = BB vs BTN = 51.7%.
   Nine-handed, all five seats from UTG to HJ got 38.8%, and blind against
   blind got 47.4% from the V11 heads-up branch. The 3-bet came from
   `THREEBET_VS[bucket]` plus the V57/V60 per-bucket bars, so it had the same
   collapse. Both the call and the 3-bet bluffs read the high-card ladder that
   V70 replaced for opens. Open size never entered the decision: a 3x open
   got exactly the 2.5x answer.

## The fix (root)

`HorseGtoDefenceRanges.ts`, consulted from `HorseLogic` (facing exactly one
raise, nobody calling, no limper, hero not yet in, no-limit two-card
hold'em, not pot/fixed limit, not short deck, not all-in-or-fold, not
straddled, three or more dealt in, opener not all-in, open up to 6bb):

- **Seats.** Opener and defender are indexed by dealt-in players still to
  act behind them, blinds included, from the dealt census
  (`preflopPlayersBehind`, the same index V70 uses: SB 1, BTN 2, CO 3, HJ 4,
  LJ 5, UTG+2 6, UTG+1 7, nine-handed UTG 8). The defender is the big blind,
  the small blind or an in-position seat. Every opener seat at every table
  size from 3 to 9 is its own seat.
- **Width.** Per-seat target widths (continue and 3-bet) for cash (no ante)
  and ante tables. Big blind, cash: vs SB 60, BTN 60, CO 49, HJ 42, LJ 36,
  UTG+2 33, UTG+1 31, UTG 29. Big blind, ante: vs BTN 72 down to UTG 44.
  Small blind cash: 16 vs BTN down to 7. In position: BTN vs CO 18, then
  -2 per extra player behind the defender. Widths scale gently with the
  open size against 2.5x (2.2x with an ante; 3x / 2.8x for a small-blind
  open).
- **Membership.** The continue order is a blend of a reference chart against
  a late open and one against an early open, mapped onto the
  `holdemPreflopScore` scale by combo share (V70's `scoreAtShare`), so every
  style multiplier, ICM premium and exploit bar keeps its units. Value 3-bets
  use the legacy ladder, which ranks the top of the deck well. Bluff 3-bets
  come from a reference bluff chart (suited wheel aces, suited kings,
  suited connectors and gappers, a few offsuit broadways against a steal),
  scaled so the bluffs fill exactly the spot's bluff width.
- **Deviations kept.** Style tightness and aggression, the ICM premium
  (`t()` / `tCall()`), depth, V11 16-25bb 3-bet-or-fold, the hunter
  discount, exploit reads (`exploitOpener` bars), V53 pressure, the
  fold-to-3-bet read, bubble pressure, style bluff budget (relative to a
  balanced horse), V57/V60 re-steal volume (x1.3) and V57's tournament
  big-blind widening all still move the base. The V60 and non-steal V57
  per-bucket 3-bet BARS are replaced: they were the old bucket widths, and
  the per-seat base replaces exactly those. V57's tournament re-steal bar
  against a late or small-blind open stays a floor (see the league section). The big blind is still not charged the cold-caller
  depth tighten or the 16-25bb flat shift, as with the V34 floor.
- **Off arm.** `v72DefenceByOpener: false` is today's defence, byte for byte.
- **Sources.** Reference charts, not a hydrated solver read. Widths follow
  the standard solver 6-max 100bb cash defence against 2.5x (GTO Wizard NL500
  simplified shape) extended to the full ring, and the big-blind-ante MTT
  chip-EV shape against 2.2x. This repository has no facing-open solver
  artifact.

Never keyed on who anyone is: a fixture with every horse/human label flipped
gives the identical defence (pinned).

## Before / after (balanced, tightness 1.0, 12 seeds, combo-weighted; call / 3-bet = total)

Every cell is `server/scratch/defend-audit.ts` (before = `off`), with the
dealt census set as live.

| context                  | spot                                          | before                                         | after                                                 |
| ------------------------ | --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| cash 6-max 100bb, 2.5x   | BB vs UTG / HJ / CO / BTN / SB                | 38.8 / 38.8 / 51.7 / 51.8 / 47.4               | 35.3 / 41.8 / 48.5 / 59.3 / 62.6                      |
|                          | BB 3-bet vs UTG / HJ / CO / BTN / SB          | 7.1 / 7.0 / 11.1 / 11.3 / 10.6                 | 5.8 / 7.4 / 8.1 / 11.1 / 11.3                         |
|                          | SB vs UTG / HJ / CO / BTN                     | 4.4/8.6 / 7.6/8.4 / 0.7/15.0 / 0.7/14.9        | 2.6/7.0 / 3.3/7.9 / 3.9/9.3 / 5.5/10.3                |
|                          | BTN vs UTG / HJ / CO                          | 12.9 / 16.0 / 18.9                             | 12.5 / 14.6 / 15.9                                    |
|                          | CO vs UTG / HJ; HJ vs UTG                     | 13.6 / 16.4; 14.3                              | 11.3 / 13.1; 9.4                                      |
| cash 6-max 100bb, 3x     | BB vs UTG / HJ / CO / BTN                     | identical to 2.5x                              | 33.0 / 39.9 / 46.1 / 56.5                             |
| cash 6-max 40bb          | BB vs UTG / CO / BTN                          | 38.8 / 51.7 / 51.8                             | 35.3 / 48.5 / 59.3                                    |
| cash 9-max 100bb         | BB vs UTG / +1 / +2 / LJ / HJ / CO / BTN      | 38.8 x5 / 51.8 / 51.8                          | 28.3 / 29.4 / 32.0 / 35.3 / 41.7 / 48.5 / 59.2        |
|                          | SB vs UTG .. BTN                              | 13.1 / 12.9 / 12.9 / 16.0 / 16.0 / 15.3 / 15.6 | 7.0 / 7.7 / 8.6 / 9.7 / 11.2 / 12.8 / 16.2            |
|                          | BTN vs UTG .. CO                              | 13.7 x3 / 17.0 / 17.0 / 19.2                   | 10.3 / 11.1 / 11.7 / 12.6 / 15.0 / 16.9               |
|                          | UTG+1 vs UTG                                  | 14.3                                           | 4.7                                                   |
| MTT 9-max 50bb BBA, 2.2x | BB vs UTG / +1 / +2 / LJ / HJ / CO / BTN / SB | 49.8 x5 / 73.4 / 73.4 / 49.7                   | 47.4 / 50.0 / 52.9 / 57.2 / 63.3 / 69.3 / 74.5 / 73.2 |
|                          | SB vs UTG / CO / BTN                          | 11.4 / 17.6 / 17.6                             | 7.7 / 18.9 / 20.1                                     |
|                          | BTN vs UTG / HJ / CO                          | 14.5 / 17.4 / 19.8                             | 12.0 / 17.8 / 21.3                                    |
| MTT 9-max 25bb BBA, 2.1x | BB vs UTG / LJ / HJ / CO / BTN / SB           | 54.9 / 54.8 / 54.8 / 76.2 / 76.2 / 54.8        | 47.9 / 58.2 / 64.6 / 69.5 / 75.0 / 74.7               |
|                          | SB / BTN / CO (3-bet-or-fold zone)            | 8.4-16.3 by bucket                             | 8.9-18.7 / 8.4-15.8 / 8.5-11.8 by seat                |
| MTT 6-max 50bb BBA       | BB vs UTG / HJ / CO / BTN / SB                | 49.8 / 49.8 / 73.4 / 73.4 / 49.7               | 57.0 / 63.5 / 69.4 / 74.7 / 73.2                      |

Hand-class shape (cash 6-max 100bb, big blind): against the button it now
defends K2o-K4o, Q5o+, J8o+, T8o+, 97o+, 86o+, 75o+, 65o, 54o and every
suited king, queen and connector. Against under-the-gun it folds K9o, Q9o,
J9o and the offsuit kings and continues with 22+, suited aces, KTs+, suited
connectors and one-gappers, AJo+, KQo and most of KJo / QJo. A2s-A5s are the
backbone of the bluff 3-bets in both spots.

## League (paired deals, 6000 pairs; a = on, b = `{ v72DefenceByOpener: false }`)

Mirror: seed 2026103172. Human field (`humanFieldTwin`): mean of seeds
2026103172-75, with the per-seed values. The league's tournament context has
no ante, so the MTT cards measure the ante-free tables. The big-blind-ante
widths are pinned by the audit and the tests only.

| card                          | mirror bb/100                                                | divergent | human field bb/100 (4 seeds) | per seed                    |
| ----------------------------- | ------------------------------------------------------------ | --------- | ---------------------------- | --------------------------- |
| nlh 100bb                     | +4.02 +/- 2.43                                               | 1187      | -1.98 +/- 3.60               | -13.00, +4.49, -0.13, +0.71 |
| nlh 40bb                      | +3.18 +/- 1.49                                               | 1161      | +1.29 +/- 1.96               | -4.16, +1.17, +8.90, -0.74  |
| nlh 200bb                     | +2.25 +/- 3.76                                               | 1236      | -5.94 +/- 5.50               | -4.95, +1.14, -20.28, +0.33 |
| mtt 40bb (180 left / 30 paid) | +0.83 +/- 1.24                                               | 909       | +2.14 +/- 1.73               | -0.31, +6.08, +1.76, +1.01  |
| mtt 25bb                      | -0.18 +/- 0.76; 3 seeds -0.12 +/- 0.47 (-0.18, +0.82, -1.01) | 807       | -1.41 +/- 1.11               | -3.87, -0.69, +0.22, -1.30  |

No card is below -2 stderr in the shipped configuration.

How the cards shaped the change:

- **Bluff width.** With the solver's full bluff width, the human-calibrated
  field ran -4.08 (100bb) / -1.37 (40bb) bb/100 averaged over five seeds;
  with half of it, -1.75 / +0.73; with none, +0.44 / +2.18. That population
  calls a 3-bet 36% of the time and 4-bets 12%, where a solver opener folds
  most of its range. So the shape is kept (same classes, frequencies in the
  same proportion) and the width is halved (`V72_BLUFF_TRIM = 0.5`). That
  puts the big blind's total 3-bet back at the old ~11% against a button.
  In the small blind and in position, the trimmed bluffs fold rather than
  flat (they are 3-bet-or-fold hands); the big blind's call, as the
  solver's do.
- **Open size.** Full pot-odds scaling (exponent 0.75, floor 0.55) ran
  -7.8 bb/100 at 100bb over three seeds against the human field (full
  bluffs in both arms), where no scaling ran -2.4. That field opens 3.75x
  with the same range it would open at 2.5x. The scaling is kept, gently
  (big blind exponent 0.35, others 0.3, floor 0.8).
- **Tournament re-steal.** With every V57 per-bucket 3-bet bar replaced, the
  MTT 25bb mirror ran -1.89 +/- 0.91 on seed 2026103172, below -2 stderr
  (three seeds: -0.80 +/- 0.53). Keeping V57's tournament re-steal bar as a
  floor against a steal (late or small-blind open) ran -0.12 +/- 0.47 over
  the same three seeds, so it stays. Against earlier opens the per-seat base
  owns the 3-bet. Tournament steal 3-bets therefore run higher than the cash
  base (MTT 9-max 50bb: BB vs BTN 14.4, SB vs BTN 19.5, BTN vs CO 11.4) with
  the same totals.
- The first seed (2026103172) is the worst human-field seed for every
  variant tried (base -21.7, half bluffs -11.6, no bluffs -5.9 at 100bb).
  About 110-160 of 6000 pairs diverge per human-field card, so one big pot
  moves a seed by several bb/100. Every human-field figure here is therefore
  averaged over several seeds, as V70 did.

## Tests

- `server/src/engine/HorseDefenceByOpener.test.ts` (new) covers:
  - module: monotone width tables, gentle open-size scaling, a permutation
    per order, membership by opener (K5o / T8o / Q8o / 87o inside the
    button's width and outside the lojack's), bluff mass equals the bluff
    width;
  - end to end: BB bands vs BTN and UTG, every opener seat changes the BB
    answer, the off arm keeps the bucket collapse (CO = BTN, UTG = HJ),
    suited/connected button defence, 3x narrower than 2.5x, SB
    3-bet-or-fold, BTN vs CO wider than vs UTG, label flip identical,
    9-max UTG narrower than the 9-max LJ, MTT 50bb BBA bands.
- Off arms added to `HorseOpponentExploitNeutrality.test-support.ts` and
  `HorseOmahaTournamentPressureCorpus.test-support.ts` (their recorded NLH
  corpora diverge), as V64/V65/V68/V69/V70 did.
- `HorseReferenceDecisionSources.ts` lists the new module, so the phase
  digests hash it.

## Follow-ups (reported, not changed)

1. **Squeezes and over-calls** (raise plus caller) still read
   `THREEBET_VS` / `CALL_VS` buckets and the old ladder.
2. **Facing a 3-bet** (the opener's defence) is still bucketed.
3. **Short-stack reshoves** (V7 13-20bb over a late open, V20 yellow zone,
   Phase 6 reshove) still read the legacy `raiserPosition` buckets. They
   belong with V71's ante-aware push/fold work.
4. **No-census fallback.** Without `dealtSeatIds`, a folded seat with no
   cards and no chips in is not counted as dealt, so offline fixtures that
   redact cards compress the ring (the probe artefact above). Live play
   always has the census.
5. **Heads-up** (two dealt in) keeps the V11 defence.
