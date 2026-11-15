# PLO6 top set that is the current nuts: full realization on the flop and turn (opt-in, default off)

Date: 2026-11-14. Lane: PLO6 audit (P6-4).

## What

- New pure module `server/src/engine/HorsePlo6TopSetNut.ts`:
  `plo6TopSetIsCurrentNuts(hole, board)` is true when a 3 or 4 card board
  has no pair, no suit three or more times and no three ranks inside any
  five-rank window (ace low and high), and the hole holds two or more cards
  of the board's top rank.
- New HorseDecideOpts option `plo6TopSetNutRealization`, read as `=== true`
  (default OFF). When on, and only in PLO6 high cash on one board outside
  bomb pots, the V38 solverless flop/turn call menu in `evaluateSpot` prices
  such a top set at realization 1 instead of the street/position factor
  (0.75 out of position on the flop for any non-draw). Receipt:
  `plo6_top_set_nut_realization_seen`. Both are registered in
  `HorseDataLedger.ts` (V93).
- Off is byte-identical: no extra random draws, no receipt.

## Why

The 0.75 discount models a marginal made hand that must give up later. A top
set that is the current nuts is not that hand. At a one-third price multiway
the discount raises the required equity from 0.333 to 0.444 and the menu
folds the nuts in most seeds. The PLO6 audit found six clear top-set folds of
this shape in two days; five reproduce on main in a reconstructed replay.

## Evidence

- `/Volumes/SmarterArchives/agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase2/postflop-screens/s4-FINDING.md`
- `.../s4-prototype-and-debug.patch`, `s4-cand-off.jsonl`, `s4-cand-on.jsonl`, `s4-compare.log`
- `server/src/engine/HorsePlo6TopSetNut.test.ts`: helper cases; a synthetic
  PLO6 cash flop where the live profile folds the current nuts in some of
  the ten complaint seeds with the option off and folds less with it on;
  controls (PLO5, tournament, paired board, three of a suit) unchanged.

## Limits

- Five reproducing cases in two days, all Horse-only cash hands.
- Reconstructed replay only (no identical-input record); a pessimistic
  continuation model (pay one more two-thirds bet) still favours the fold in
  four of six.
- PLO4 and PLO5 are deliberately outside the gate; they were not measured.
- Default OFF. Turning it on needs its own evaluation and a
  `docs/horse-default-on.d/plo6TopSetNutRealization.md` evidence file under
  the HorseDefaultOnNeedsEvidence law.
