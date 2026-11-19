# omahaFoldModelFittedOnPeople: authority for the live switch

Owner order (verbatim, WooWoo PLO audit programme): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS". Build: WooWoo audit lane FOLD-MODEL (archive repairs/FOLD-MODEL; measurement repairs/FOLD-SHARE/MEASUREMENT.md). Evaluation: repairs/FOLD-MODEL/EVAL-DECLARATION.md (declared with its sha256 before the run) and its result file. Default OFF. Evidence status is recorded in the result file; nothing here authorizes a switch-on, and no option-switch row may name this option before the engine serving production is a build that contains it.

## What it does

PLO4/PLO5 cash in the priced scope (`omahaPricedInScope`: no tournament, no fast-table cash, one board, no bomb pot, high only), on the flop or the turn, heads-up against a person, with nothing to call: the v38 EV engine (`HorseEvEngine.evaluateSpot`, called from the HorseLogic V38 block) prices his fold to every bet size `s` into the pot `P` with

fold = clamp(mdf x pf x R, 0.02, 0.92), mdf = s/(P+s), pf = (d/dPop)^1.5, R = (folds_c + 8 x r0) / (mdfUnits_c + 8), r0 = clamp(OMAHA_EV_FOLD_MODEL multiplier for him, 0.4, 1.8) / pf

in place of `mdfFold(P, s, foldMul)` (EvSpot.foldShareOf). The card-removal delta of the hand still applies on top.

- Cells c: variant x street (flop, turn) x pot type (preflop raises 0 / 1 / 2 / 3+) x bet-size bucket (s/P up to 0.40, 0.60, 0.85, above), `OMAHA_PERSON_FOLD_CELLS`: people's folds and the sum of mdf x pf over 3,417 heads-up person answers to a Horse's first bet of the street (flop 1,995, turn 1,422), PLO4/PLO5 cash, 2026-11-04 10:24Z to 2026-11-18 09:58Z, read-only production (fit.json sha256 8a9e14538fa593a83f018868e43944d0630133ea686f3411eaa68b3f87cd9773). Humans and Horses are told apart by the action origin (`horse_policy` vs `player` / `pre_action`), as the FOLD-SHARE and FOURBET evaluations did.
- Shrinkage to the old model: a cell with few answers prices exactly as OMAHA_EV_FOLD_MODEL did for him (r0); 8 mdf-units (about 25 answers) is the time-split cross-validated choice (log loss 0.5785 on the later 1,026 answers vs 0.5908 for the old model).
- His own read: d = (his folds + 16 dPop) / (his faced first postflop bets + 16) from his durable fold-to-bet counters (`HorseMind.foldToBetCountersOf`), dPop the person population of that read (0.4235 PLO4, 0.4297 PLO5); elasticity 1.5 cross-validated.
- Why: OMAHA_EV_FOLD_MODEL's fold over MDF (1.289 / 1.458) was fitted with every seat pooled, Horses included; people fold about MDF on the flop and turn, so the old model overstates bluff EV against people.
- For that opponent the fitted share replaces the whole multiplier chain (evFoldMul, V53, V86, style). Against a Horse or an opponent of unknown kind, multiway, facing a bet, on the river, or out of scope nothing changes (`omaha_fold_model_fitted_on_people_unpriced_kept` where it was in scope but not priceable).

No size, hand-class or position threshold decides: the size bucket selects which measured cell prices the bet, the size enters continuously through mdf, and the bet or check is still chosen by the engine's EV.

## Receipts

omaha_fold_model_fitted_on_people_priced, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaFoldModelFittedOnPeople.test.ts: the fitted lookup (cell selection, shrinkage to the old model on an empty cell, his read, closed form), the engine hook (absent and null keep mdfFold, never read facing a bet), the option gate (off: no fold share and a whole decision byte-identical; on: priced with receipts; scope: Horse, multiway, river, tournament, facing a bet).

## Limits

- His fold is not stored per street or pot type per player, so his own evidence is one factor from his pooled postflop fold read; the counters are a 2026-11-18 snapshot, so the fit window's personal factors include some of its own hands (disclosed).
- The cells are conditional on the bets Horses made; a bucket Horses rarely use falls back toward the old model.
- The river is not priced by the v38 engine; people fold more than the old model credits on the river (measured, not used here).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
