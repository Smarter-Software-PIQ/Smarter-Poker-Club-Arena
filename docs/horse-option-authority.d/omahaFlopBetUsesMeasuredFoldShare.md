# omahaFlopBetUsesMeasuredFoldShare: authority for the live switch

Owner order (verbatim, WooWoo PLO audit programme): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS". Build: WooWoo audit lane FOLD-SHARE (root cause of finding FOURBET F1; archive repairs/FOLD-SHARE/MEASUREMENT.md). Evaluation: repairs/FOLD-SHARE/EVAL-DECLARATION.md (declared with its sha256 before the run) and its result file. Default OFF; evidence status is recorded in the result file, and nothing here switches it on.

## What it does

PLO4/PLO5 cash in the priced scope (`omahaPricedInScope`), on the flop, heads-up against a person, with nothing to call: the v38 EV engine (`HorseEvEngine.evaluateSpot`, called from the HorseLogic V38 block) prices his fold to every bet size `s` into the pot `P` with

logit f = b0 + bMdf.logit(s/(P+s)) + pot type + SPR band + variant + Horse out of position + bPersonal.(logit(d) - logit(dPop))

in place of `mdfFold(P, s, foldMul)` (EvSpot.foldShareOf). The card-removal delta of the hand still applies on top. d = (his folds + 16.dPop) / (his faced first postflop bets + 16), from his durable fold-to-bet counters (`HorseMind.foldToBetCountersOf`, the row `omahaEvFoldMulOf` reads), shrunk toward the person population dPop.

- Constants: `OMAHA_FLOP_BET_PERSON_FOLD_FIT`, the maximum-likelihood logistic fit on 1,433 heads-up person answers to a Horse's first flop bet (PLO4/PLO5 cash, 2026-11-04 to 2026-11-16 16:29Z, read-only production; fit.json sha256 7b5c182c4a53f0cc). Pot type = preflop raises (0, 1, 2, 3+; `preflopRaiseCount`); SPR band = effective stack / pot (<2, 2-4, 4-8, 8+). Prior strength 16: time-split cross-validation is flat over 4..64 and the between-person dispersion gives 13.9.
- Why: persons fold 0.311 heads-up to these bets where the engine's base fold model credits 0.379 (0.439 at the population read) before the V53 pressure, V86 fold-to-cbet and style multipliers; OMAHA_EV_FOLD_MODEL's fold over MDF (1.289 / 1.458) was fitted on every seat pooled and persons fold about MDF.
- For that opponent the measured share replaces the whole multiplier chain (evFoldMul, V53, V86, style). Against a Horse or an opponent of unknown kind, multiway, facing a bet, on the turn, or out of scope nothing changes (`omaha_flop_bet_measured_fold_share_unpriced_kept` where it was in scope but not priceable).

No size, hand-class, SPR or position threshold: the bands are fitted log-odds terms, the size enters continuously, and the bet or check is still chosen by the engine's EV.

## Receipts

omaha_flop_bet_measured_fold_share_priced, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaFlopBetMeasuredFoldShare.test.ts: engine identity without the fold share (absent, declining, and mdfFold itself); facing a bet never read; the closed form; size monotone and continuous; his record shrunk toward the population; the measured gap against the base model; scope (off, Horse, turn, tournament, facing a bet); a whole decision off byte-identical and on with receipts.

## Limits

- His per-pot-type / per-SPR fold is not stored per player (horse_exact_profiles.street_counters is empty in production), so his own evidence is one fitted log-odds shift from his pooled postflop fold read.
- The personal slope was fitted against today's counter snapshot, which includes some of the fitted hands (disclosed leakage).
- The measured share is conditional on the bets Horses made; sizes Horses rarely use are extrapolated by the fitted size slope.
