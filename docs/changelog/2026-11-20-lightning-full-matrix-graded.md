# 2026-11-20: the 270-cell Lightning selection matrix, graded

Antigravity Coordinator (session_01UxDLnHu4P9fWx3X7Mp5FjM). Lightning is Action and Madness only; nothing here touches a Classic game.

## What was graded

- Data: the Lightning lane's selection stage of 2026-11-15 to 2026-11-18, `lightning-horse-01Gw7aDrLukB/runs/selection/` on SSD2: 270 `*.pairs.jsonl` files (one per cell, five seeds each) and the aggregated `LightningEvalSummary-20261118.json` (20,874,859 bytes, sha256 `28fb15504640be252ba52f5d2ea3f2cb0173b98766360264f82708616fcb0618`). Complete: 270 of 270 cells, 1,350 (seed x cell) slices, 2,970,000 paired hands, seeds 31470001 to 31470005, 2,200 hands per cell and seed.
- ONE candidate only: `{"lightningParticipationHoldem":true,"lightningParticipationOmaha":true}` at source `6cbde988bf347c7d631e34140d2079e4fbfc2570`, against the served baseline (seven style options ON, switch read 2026-11-15T13:31:59Z), hero scope. No other option was in this run. `lightningEarlyFoldNeedsFoldThrough`, `lightningStyleReadSeparate`, `omahaPricedInLightning`, `omahaReraisedPositionInLightning` and `lightningVpipFloorLimpOnly` were NOT evaluated by it and are not graded here.
- Protocol: `09-EVALUATION-PROTOCOL-v2.md` (Lightning evidence archive, frozen before any selection seed; draft 3 changes only the operating rules on the shared Mac).
- Method: P1, G5 and G6 by the repository's own pooling function, `mergeLightningEvalPairs` (`server/src/lightning/LightningPairedEval.test-support.ts`), called by a scratch script over all 270 side files. The merge test itself (`LIGHTNING_EVAL_MERGE`) refuses these files because the run predates the `.complete.json` marker. The other gates were read from the summary's per-cell counters by a scratch reader. The figures match the lane's own write-up of 2026-11-20 (`09-EVALUATION-RESULTS-SELECTION.md`), which stopped at "keep both OFF" and never changed the source.

Attribution per option is clean: `lightningParticipationEligibility` (HorseLightningParticipation.ts) gives a hold'em table only to `lightningParticipationHoldem` and an Omaha table only to `lightningParticipationOmaha`. So the NLH figures belong to the hold'em option, and the PLO4/PLO5 figures belong to the Omaha option.

## The gates, quoted

- G1 "Illegal actions 0 and illegal amounts 0 in every cell, both arms." G2 "Decide exceptions 0; policy fallbacks not higher than baseline in any cell." G3 "Unsettled hands 0."
- G4 "candidate p95 and p99 not worse than baseline by more than 10% in any variant (... judged on the pooled ratio, not per cell)."
- G5 "in each of `tag_regular`, `three_bet_heavy` and `three_bet_heavy x2`, per variant, the paired bb/100 difference is not below -2 standard errors."
- G6 "Every other field (station, nit, tight_value, maniac, gear_changer): per variant, paired difference not below -2 standard errors."
- G7 "within a cell, the hero's entry rate in hands following 5 or more consecutive non-entries is not higher than its overall rate by more than sampling error."
- G8 "Existing laws untouched and green on the candidate head." G9 "Null control: zero divergent decisions."
- Decision rule (section 6): promotable only when "1. every guard G1 to G9 holds; and 2. P1 per variant is not negative by more than one standard error in the primary fields (non-inferior), and is positive by at least two standard errors in at least one variant; and 3. P2 rises in every variant in which the candidate engages, with Q1 and Q2 monotone and Q3 showing the bottom-quartile share of entering hands not above baseline by more than 5 percentage points; and 4. Q4: at least two thirds of the VPIP gain comes from first-in raises and priced big-blind defence." And: "Any failed guard: the candidate is rejected or returned to development." Judgement "is on the pooled per-variant figures".

## P1 and the field guards (bb/100, candidate minus baseline; se used = larger of per-hand and orbit-block; 99,000 paired hands per field, 198,000 primary)

| variant | group | diff | se used | z | gate |
| --- | --- | --- | --- | --- | --- |
| NLH | primary (all_horse + unknown) | -0.242 | 0.322 | -0.75 | P1 non-inferior; not +2 SE |
| NLH | tag_regular | -0.118 | 0.324 | -0.36 | G5 pass |
| NLH | three_bet_heavy | -0.874 | 0.472 | -1.85 | G5 pass |
| NLH | three_bet_heavy x2 | -0.330 | 0.446 | -0.74 | G5 pass |
| NLH | station | +0.2 | 0.2 | +0.99 | G6 pass |
| NLH | maniac | -0.5 | 0.3 | -1.71 | G6 pass |
| NLH | gear_changer | -0.3 | 0.3 | -0.85 | G6 pass |
| NLH | nit | -0.748 | 0.361 | -2.07 | **G6 FAIL** |
| NLH | tight_value | -1.008 | 0.395 | -2.55 | **G6 FAIL** |
| PLO4 | primary | +0.537 | 1.323 | +0.41 | P1 non-inferior; not +2 SE |
| PLO4 | tag_regular / 3bh / 3bh x2 | -0.377 / -3.347 / +1.753 | 1.742 / 3.071 / 3.985 | -0.22 / -1.09 / +0.44 | G5 pass |
| PLO4 | station / maniac / gear / nit / tight_value | +10.7 / +4.7 / -0.5 / +1.851 / +0.185 | 2.6 / 3.2 / 2.4 / 1.637 / 1.730 | +4.04 / +1.44 / -0.23 / +1.13 / +0.11 | G6 pass |
| PLO5 | primary | +0.243 | 1.327 | +0.18 | P1 non-inferior; not +2 SE |
| PLO5 | tag_regular / 3bh / 3bh x2 | +0.485 / -3.747 / -4.541 | 1.815 / 2.773 / 3.339 | +0.27 / -1.35 / -1.36 | G5 pass |
| PLO5 | station / maniac / gear / nit / tight_value | +8.9 / -5.8 / -3.0 / +2.177 / +0.014 | 2.4 / 4.3 / 2.3 / 1.683 / 1.805 | +3.77 / -1.34 / -1.32 / +1.29 / +0.01 | G6 pass |

Power: every primary se (0.32, 1.32, 1.33) is under the declared 1.5 ceiling (section 7a).

## The other gates

| gate | NLH | PLO4 | PLO5 | verdict |
| --- | --- | --- | --- | --- |
| G1 illegal actions / amounts / conservation, both arms | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | pass |
| G2 decide throws; fallbacks cand vs base | 0; 0 vs 0 | 0; 0 vs 0 | 0; 0 vs 0 | pass |
| G3 unsettled hands | 0 | 0 | 0 | pass |
| G4 pooled p95 / p99 ratio (decision-weighted) | 1.002 / 0.998 | 1.003 / 1.021 | 1.009 / 1.011 | pass (no latency side files; ratio from per-slice percentiles) |
| G7 after-streak vs overall entry rate (pooled, candidate) | 29.23% vs 31.08%, z -15.8 | 28.34% vs 28.98%, z -5.8 | 28.03% vs 28.55%, z -4.8 | pass: no rebound; per-slice z > 2 in 11, 12, 8 of 450 (baseline arm 9, 8, 7: chance) |
| G8 laws on the candidate head | not re-run by this grade | | | lane logs only |
| G9 pairing | 300 NLH slices (50 and 200 bb) where the option is inert: 0 divergent decisions; preSubjectNonSubjectDivergent 0 in all 1,350 slices | | | pass |
| P2 VPIP primary (no-walk) | 32.86 -> 33.10% | 25.31 -> 28.75% | 26.08 -> 28.16% | rises |
| Q1 first-in non-decreasing earliest seat to button | monotone at 4, 5, 6 players | monotone | monotone | pass |
| Q2 big-blind fold share non-increasing as price improves (buckets 0.22-0.27 / 0.27-0.33 / >0.33) | 40.6 / 47.0 / 42.4% | 38.9 / 53.0 / 15.2% | 39.8 / 54.2 / 11.6% | FAIL as written, in BOTH arms (baseline 42.5/47.2/42.3, 39.0/55.8/15.8, 39.7/56.9/12.7): a baseline property |
| Q3 bottom-quartile entry share, delta | 9.21 -> 9.59% (+0.38) | 2.86 -> 3.01% (+0.15) | 3.55 -> 3.79% (+0.24) | pass (<= +5) |
| Q4 intended share of the VPIP gain | 99.3% | 88.0% | 92.0% | pass (>= 2/3) |

In NLH only the 100 bb slices diverged (150 of 450); the 50 bb and 200 bb slices made no different decision, so the hold'em option's whole effect, and its whole loss to the nit and tight_value fields, sits in the 100 bb cells.

## Decisions

| option | outcome | why | change |
| --- | --- | --- | --- |
| `lightningParticipationHoldem` | **REJECTED, measured harm** | G6 failed in NLH, the only variant it acts in (nit z -2.07, tight_value z -2.55); "Any failed guard: the candidate is rejected". It also gained nothing: NLH primary -0.24 (z -0.75), VPIP +0.24 points | added to `OPTION_SWITCH_OFF_ONLY` (status harm); switch list re-asserted by migration `20261121001506_horse_option_switch_lightning_participation_holdem_harm` and the PostgreSQL proof script |
| `lightningParticipationOmaha` | not promotable, not harmful | every PLO guard holds; P1 non-inferior but no variant +2 SE (PLO4 +0.41, PLO5 +0.18), and Q2 is not monotone (in both arms) | none: it stays off-only under its existing owning-lane hold |

Nothing was switched in any database and no row was written. The new migration re-asserts the lists and raises, installing nothing, if a row already holds `on` or `on_shadow` for `lightningParticipationHoldem` (the lane reported zero rows for it).

Not covered (no data in this run): `lightningEarlyFoldNeedsFoldThrough` (a coordinator partial pool of 6 NLH 4-handed cells today read -3.6 +/- 1.6 bb/100, z -2.23; that pool is not this protocol's matrix and decides nothing here), `lightningStyleReadSeparate`, `omahaPricedInLightning`, `omahaReraisedPositionInLightning`, `lightningVpipFloorLimpOnly`.
