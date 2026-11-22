# horseRiverNoBlockerBet: authority for the live switch

Built 2026-11-19 by lane RIVER-BLOCK (helper of the PLO/WooWoo successor, lead session_01TLQer8xSzdhPzuDRJXTPag). Default OFF (read as `=== true`). Status: **OFF in source, Evidence NOT MET for statistical league gain.** Real-hand replay across HVH48 cash sets (D, B, A; 9,777 replayed nodes on the 67-row / 51-ON production switch snapshot `prod-switch-20261122T0336Z.json`) is net positive (`4 fixed / 1 newlyWrong`, `3:1` on NLH HVH48-D, `1/0` on PLO5 Lightning HVH48-A, `0/0` plus `25` PLO4/5 sub-40% river bets resized up to >=40% pot, `0` illegal, `0` refused, `0` errors), while 3-seed NLH league runs (`nlh_horse_river_no_blocker_bet` mirror `+0.02 +/- 0.12 bb/100, z = +0.16`, `human_nlh_horse_river_no_blocker_bet` human field `-0.33 +/- 0.25 bb/100, z = -1.31`, `0` illegal/truncated/corrected/fallbacks) are both `not resolved` (neither statistically harmful nor a proven league gain; PLO4/PLO5 league cards and latency remain unmeasured). Any live switch-on rests on the explicit owner order below and lead/owner sign-off once the serving build contains this option and authority file; until then no option-switch row may name it.

## The owner's order it rests on (verbatim)

- Owner order 2026-11-19 16:47 America/Chicago: "REMOVE BLOCKER BETS ON THE RIVER FOR HORSES, THEY ARE ALMOST ALWAYS WEAKNESS AND THEY ALMOST ALWAYS FOLD AFTER BLOCK BETTING TO A BIG RAISE"

## What it does

Hold'em (NLH) and PLO4/PLO5 cash (table cash and Lightning; **PLO6 is explicitly excluded in source** at `HorseRiverNoBlockerBet.ts` via `[4, 5].includes(vi.holeCount)` per owner ruling 2026-11-19 8:26 PM Chicago), one board, high only, not fixed limit, not All-In-Or-Fold, not a bomb pot; tournaments excluded. On the river, with nothing to call, when the Horse's final decision of the wager_rules node is a bet smaller than the threshold share of the pot (`RIVER_NO_BLOCKER_BET_MIN_SHARE` in `server/src/engine/HorseRiverNoBlockerBet.ts`: PLO 40%, hold'em 25%), the bet becomes:

- priced (PLO4/PLO5 heads-up inside the card-impact scope, `HorseOmahaCardImpact.ts`): the check against the cheapest legal bet at or over the threshold, on the card-impact model with the measured response of his kind (`omahaSmallBetCurve`, where the variant is measured); the higher expected value wins and a tie checks;
- not priceable (hold'em, multiway, PLO outside the card-impact scope): the check, except a hand holding the river nuts by a hole card (`hasRiverNuts` with private value), which bets the threshold size.

Never the turn or an earlier street, never an all-in, never a bet already at or over the threshold. Off or unset: byte-identical (same decision, same random draws, no receipt).

## The threshold (measured)

Archive `woowoo-48h-audit-01BNteGYgf/repairs/RIVER-BLOCK/MEASURE.md`: every Horse river first bet (not a raise) in production cash hold'em and PLO4/PLO5/PLO6, 7 days to 2026-11-19 17:00 Chicago, from `hand_history` (2-hour created_at windows, read only). PLO: when a bet under 40% of the pot was raised, the Horse folded almost every time (0-15%, 15-25% and 25-40% bands), against far fewer folds to a raise of a bet of 40% or more; the 0-15% band also lost chips. Hold'em: the same under 25%; 25-40% was not raise-then-fold dominated, so hold'em keeps it.

## Receipts

`river_no_blocker_bet_checked`, `river_no_blocker_bet_resized_priced`, `river_no_blocker_bet_resized_nuts`, `river_no_blocker_bet_failed`. A small bet placed by `omahaSmallBetIsPriced` and replaced here fires that rule's `_vetoed` receipt (its receipt describes the final action).

## Tests

`server/src/engine/HorseRiverNoBlockerBet.test.ts`: the registered name and the stated threshold; the spot (in and out of scope by share, the turn, all-in, hold'em); the verdict (never a bet under the threshold, priced choice by EV, hold'em air checks and the nuts bets the threshold); off byte-identical (unset, false, truthy non-boolean); decide level on recorded PLO5 river spots with the live small-bet pricing on: the option off makes river bets under 40% of the pot there, on makes none, every change carries a receipt and passes the worker validator; the turn and a tournament river unchanged with it on. The decide-level test fails without the HorseLogic wiring and passes with it.

`server/src/benchmark/HorseLeagueHumanField.test.ts`: pins `human_nlh_horse_river_no_blocker_bet` as the 6-max NLH human-calibrated twin of `nlh_horse_river_no_blocker_bet` (live cash Hybrid hero, deal-seeded mood clock) and verifies non-inert divergence (`2,000` pairs, seed `4242`).

## League evaluation (2026-11-22, NLH mirror and NLH human-calibrated field)

Measured 2026-11-22 on engine revision `b4209890b7ab`, `EQUITY_GOVERNOR=off`, offline solver stores (`charts=0`, `postflop=0`, `postflopV31=0`), over the live 67-row / 51-ON production switch snapshot (`prod-switch-20261122T0336Z.json`): arm A adds `horseRiverNoBlockerBet: true`, arm B is the 51-ON production switch set.

### `nlh_horse_river_no_blocker_bet` (6-max NLH mirror, `productionStyles: true`, 6,000 pairs / seed)

| seed            | pairs (hands)       | divergent pairs | bb/100 (A - B) | stderr     | blockStderr | z         | verdict          | illegal / trunc / corr / fb | wall    |
| --------------- | ------------------- | --------------- | -------------- | ---------- | ----------- | --------- | ---------------- | --------------------------- | ------- |
| `20261121`      | 6,000 (12,000)      | 3               | +0.2722        | 0.2073     | 0.2053      | +1.31     | not resolved     | 0 / 0 / 0 / 0               | 115.2 s |
| `20261122`      | 6,000 (12,000)      | 0               | 0.0000         | 0.0000     | 0.0000      | n/a       | INERT            | 0 / 0 / 0 / 0               | 114.0 s |
| `20261123`      | 6,000 (12,000)      | 14              | -0.2153        | 0.2850     | 0.3073      | -0.76     | not resolved     | 0 / 0 / 0 / 0               | 116.0 s |
| **3-seed mean** | **18,000 (36,000)** | **17 (0.094%)** | **+0.0190**    | **0.1175** | n/a         | **+0.16** | **not resolved** | **0 / 0 / 0 / 0**           | 345.2 s |

### `human_nlh_horse_river_no_blocker_bet` (6-max NLH vs `human-calibrated-v1-20261008`, Hybrid hero, `moodClock: deal_seed`, 12,000 pairs / seed)

| seed              | pairs (hands)       | divergent pairs | bb/100 (A - B) | stderr     | blockStderr | z         | verdict          | illegal / trunc / corr / fb | wall    |
| ----------------- | ------------------- | --------------- | -------------- | ---------- | ----------- | --------- | ---------------- | --------------------------- | ------- |
| `20261121`        | 12,000 (24,000)     | 11              | -0.3515        | 0.6392     | 0.6383      | -0.55     | not resolved     | 0 / 0 / 0 / 0               | 52.9 s  |
| `20261122`        | 12,000 (24,000)     | 11              | -0.3107        | 0.3587     | 0.3509      | -0.87     | not resolved     | 0 / 0 / 0 / 0               | 52.3 s  |
| `20261123`        | 12,000 (24,000)     | 7               | -0.3286        | 0.1866     | 0.1816      | -1.76     | not resolved     | 0 / 0 / 0 / 0               | 54.0 s  |
| **3-seed pooled** | **36,000 (72,000)** | **29 (0.081%)** | **-0.3302**    | **0.2521** | n/a         | **-1.31** | **not resolved** | **0 / 0 / 0 / 0**           | 159.2 s |

Interpretation of NLH league results: trigger frequency is very low (~0.08-0.09% of pairs), neither card crosses the harm threshold (`z < -2.0`), and neither proves a positive gain (`not resolved`). All three human-field seeds are consistently slightly negative (`-0.35`, `-0.31`, `-0.33 bb/100`) because on NLH the rule checks all non-nuts `<25%` pot river bets unpriced, giving up thin value against the calibrated field which raises small river bets less aggressively than the exploitative players measured in `MEASURE.md`. PLO4/PLO5 league cards (`plo4_horse_river_no_blocker_bet`, `plo5_horse_river_no_blocker_bet`) are owned by PLO Strategy and have not yet been run here.

## Evidence rows

- Owner order for this behaviour, by name: MET (2026-11-19 16:47 Chicago, verbatim above).
- Production measurement of the band it removes: MET (MEASURE.md above).
- Replay on real audited cash decisions (HVH48-D, HVH48-B, HVH48-A; 9,777 replayed nodes): NET POSITIVE (`4 fixed / 1 newlyWrong`, `3:1` on NLH cash, `1/0` on PLO5 Lightning, `0/0` + `13` resized on PLO4/5 table, `0` illegal, `0` refused, `0` errors; small sample of `8` action-class changes and `25` PLO resizes).
- League evaluation (NLH cards `nlh_horse_river_no_blocker_bet` and `human_nlh_horse_river_no_blocker_bet`): MEASURED, NOT RESOLVED (mirror `+0.02 +/- 0.12 bb/100 z = +0.16`, human field `-0.33 +/- 0.25 bb/100 z = -1.31`; no statistical harm, no statistical gain). PLO4/PLO5 league cards (`plo4/plo5_horse_river_no_blocker_bet`): NOT MET (not run).
- Decision latency: NOT MET (not run).

## Replay

Measured 2026-11-22 on engine revision `b4209890b7ab` over `prod-switch-20261122T0336Z.json` (67 rows, 51 ON) with as-of-decision opponent history (`76,098` hands) via `server/scripts/audited-node-option-replay.ts` and `server/scripts/audited-decision-replay.ts --row`:

- Replay: fixed 3; newlyWrong 1; changed 6; unchanged 2728; unjudged 2; set HVH48-D Hold'em cash vs people 48h (memory as of decision); scorer b4209890b7a; source placed verdict-only; arm rnb vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 3762; unjudged 1; set HVH48-B PLO4/PLO5 table cash vs people 48h (memory as of decision); scorer b4209890b7a; source placed verdict-only; arm rnb vs off; replayed 3763 of 3884
- Replay: fixed 1; newlyWrong 0; changed 1; unchanged 3279; unjudged 0; set HVH48-A PLO5 Lightning vs people 48h (memory as of decision); scorer b4209890b7a; source placed verdict-only; arm rnb vs off; replayed 3280 of 3280

Per-set detail (0 illegal, 0 refused, 0 errors across all 9,777 replayed nodes):

- **HVH48-D (NLH cash, 2,734 replayed of 3,891; base reproduces 2,373):** `7` total diff rows, `6` action-class changes (all `river_no_blocker_bet_checked`, 0 more aggressive / 6 more passive), `0` resized; `fixed 3`, `newlyWrong 1`, `stillWrong 0`, `ok->ok 0`, `unjudged 2`.
- **HVH48-B (PLO4/PLO5 table cash, 3,763 replayed of 3,884; base reproduces 3,005):** `15` total diff rows, `1` action-class change (`river_no_blocker_bet_checked`), `13` resized up to >=40% pot; `fixed 0`, `newlyWrong 0`, `unjudged 1`.
- **HVH48-A (PLO5 Lightning, 3,280 replayed of 3,280; base reproduces 2,740):** `22` total diff rows, `1` action-class change (`river_no_blocker_bet_checked`, fixed), `12` resized up to >=40% pot; `fixed 1`, `newlyWrong 0`, `unjudged 0`.

## Verdict

Evidence NOT MET for statistical league gain (`human_nlh_horse_river_no_blocker_bet` `-0.33 +/- 0.25 bb/100, z = -1.31`, `not resolved`; `nlh_horse_river_no_blocker_bet` `+0.02 +/- 0.12 bb/100, z = +0.16`, `not resolved`; PLO4/PLO5 league cards not yet run). Real-hand HVH48 replay is net positive (`4 fixed / 1 newlyWrong` across 9,777 nodes, `0` illegal/refused/errors). Keep default OFF in source until the owner/lead either activates under the 2026-11-19 16:47 owner order (with PLO4/PLO5 league verification) or adds EV-priced NLH river sizing so thin value bets are not checked away unpriced.
