# plo6FacingBetIsPriced: authority for the live switch

Status: built, OFF, off-only (measured harm), Evidence NOT MET, DECLARED EVALUATION FAIL (measured harm on F6; locked off-only in `OPTION_SWITCH_OFF_ONLY`, status `harm`; 2026-11-20 PR #11511 `ea4030176aa3977ee3ed8c6d07acd6a3843c654e` + E6/E7/E8 repairs PR #11578 `f94c25f0ce0598370d78f7b683150af8fb9975aa`; declared human-field/mirror evaluation `eval-40aba893fbc9` finalized 2026-11-21). Mechanism, scope, receipts, validator admission, law tests (`Plo6FacingBetIsPriced`, `Plo6FlopDefence` [E6], `Plo6RiverDefence` [E7], `Plo6MultiwayTurnField` [E8]) and off-identity are MET; the HVH48 auditor C PLO6 replay (`11,558` decisions across `1,218` hands, committed scorer `2752840674e`) scored `fixed 87 / newlyWrong 36`, `87 / 37`, `88 / 37` (though true-card `fold -> call` EV vs OFF remained `-69.9 bb` net, `-334.4 bb` on river `fold -> call`, with `+494.4 bb` measuring improvement over `#11511`'s `-564.3 bb`). On the declared PLO6 human-field and Horse-mirror evaluation (`eval-40aba893fbc9`, `DECLARATION-PLO6-FACING-BET-IS-PRICED.md` sha256 `95ca359fb420389e6cc33f79ce52ff6237fd45eff439daa45cebcb0880a048e2`, `valid: true`), `F6` (`400/400` sessions, `200,000` pairs / `400,000` hands vs `HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`) measured **`-15.510 +/- 2.655 bb/100` (`z = -5.84`)** and `M6` (`100/100` sessions, `50,000` pairs / `100,000` hands) measured **`+1.483 +/- 1.319 bb/100` (`z = +1.12`)**, with `0` illegal/truncated/corrected/fallbacks. Because `z(F6) = -5.84 < -2.0`, the declared verdict is **FAIL** (`plo6FacingBetIsPriced` locked in `OPTION_SWITCH_OFF_ONLY`, status `harm`, read `=== true`, release default off, no switch row). **Do not write an `on` or `shadow` switch row.** Nothing in this file switches anything on its own.

## The owner's rules it rests on

- No blanket rules; every Horse decision priced by range, equity and EV; a bet size never triggers a decision by itself (HORSE DECISIONS lane brief, 2026-11-19, lead session 01TLQer7J; owner 2026-11-17 11:49, quoted in `HorseOmahaPricedRules.ts`).
- Audit: HVH48 auditor C, `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6/REPORT.md` (11,558 PLO6 Horse decisions against people over 48 hours; 183 fold mistakes facing a bet, 156 of them flipped by switching the six fold rules off).

## What it does

PLO6 runs on the categorical Omaha path; every priced Omaha option is PLO4/PLO5 only (`omahaStrategyInPlo6` is held off). Facing a bet a PLO6 Horse folded by: the random-hand river fold (`plo6RiverNutDiscipline`, V58/V59: a river call over 10% of the pot folds when one random six-card hand beats the Horse 15% / 30% of the time, whatever the bettor's range and the price; its other arm turns raises into calls), the class ceilings on the equity (V15, V40, V87), the paired-board fold (below a full house, any bet of a quarter of the stack), and the paired-river check (below a full house, the river is checked after a called turn bet on a paired board).

With `plo6FacingBetIsPriced` on, in PLO6 cash (a table or Lightning; never a tournament, a bomb pot, All-In-Or-Fold, hi-lo or more than one board), facing a bet or a raise, the answer is priced on the Horse's exact six cards against the bettor's line range (`server/src/engine/HorsePlo6FacingBetIsPriced.ts`):

- Turn and river (`HorsePlo6MultiwayTurnField.ts` [E8] and `HorsePlo6RiverDefence.ts` [E7]): heads-up turn and river spots use the exact counts of `HorseOmahaFacingBetEv` with six cards (`omahaEvHandCountsSixCardTurn`, every unseen two-card pair scored with the engine's evaluator, the Horse's cards, the board and known dead cards removed; on the turn every river card). Multiway turn spots (`callers + allIns + behind > 0`, E8) walk every unseen river card on disjoint six-card opponent holdings (`plo6MultiwayTurnJoint`) with six-card `C(6,2) = 15` pair-concentrated caller/behind shares (`6/15` of the four-card pool share), binomial continuing players behind (`omahaFlopEvBehindContinue`), and `OMAHA_SHOWN_TURN_REALIZATION` instead of static 4-card turn board scores (`heroNow` without river cards). On the river (E7), multiway spots (`callers + allIns + behind > 0`) evaluate disjoint six-card showdown sets (`plo6MultiwayRiverVerdict`) with `plo6ValueShareAtSameStrength` caller/all-in ranges and measured multiway river non-value scaling (`PLO6_MW_RIVER_BLUFF_SCALE = 0.25`, reflecting `3/85` multiway vs `41/256` heads-up river non-value bets across 1,218 PLO6 hands); `plo6RiverFoldGuardStands` guards river raises (`29/29` measured raises had `0.0%` bluffs) and value-dominated non-flush/non-boat bluff-catchers (`beaten >= 0.60`, `vsValue < 0.15`); `plo6RiverCurrentNutsCallSpot` enforces the six-card exact current-nuts river call floor (`hasRiverNuts` when `(pot + paid) / (live + 1) >= paid`); and `plo6HasPrivateRiverNuts` + `plo6RiverStandingCallHolds` preserve nut-end river jams (`#59962430` quads Aces, `#59973676`, `#59974331`) and value-live standing river calls (`#60091132`) while folding dominated river calls (`#59973335`).
- Flop (`HorsePlo6FlopDefence.ts` [E6]): heads-up facing the first flop bet with chips behind, a call must clear both the fitted hand-class realization (`omahaFlopFittedRealization`) and the class-fitted two-street barrel tree (`omahaFlopDefenceTreeEv`, `PLO6_FLOP_DEFENCE_TREE_INPUTS`) on the hand's sampled six-card runouts; multiway on the flop, caller, all-in and behind shares are concentrated by `6/15` for six-card `C(6,2) = 15` holdings, non-nut multiway draws (`hasNutQualityMultiwayDraw === false`) take `pair` realization, and non-final multiway `pair` realization scales by `1 / (1 + 0.35 * mwOpponents)`.
- The value region at the same hand strength (`server/src/engine/HorsePlo6ValueShare.ts`): the value shares were set on four- and five-card holdings; the strongest V of six-card holdings is a much higher bar on the same board (on a paired board it is all quads). The six-card region is taken at the strength of the top V of four-card holdings on this board, sampled with a seed from the cards. STATED, not measured.
- No random-hand share decides anything: the SPEC-A 3.12 six-card fold guard (`plo6FacingBetEvFoldStands`) is passed off; the verdict reads no option, no opponent memory and no priced-mode state, so the receipt validator re-runs it on the request.

Where it acts (`HorseLogic.ts`):

1. `plo6RiverNutDiscipline` does not run in this scope (receipt `plo6_facing_bet_priced_river_nut_rule_not_run`).
2. `pairedBoardFold`: where the call is priced the fold stands aside; a flop or turn raise it would have folded becomes the call (`plo6_facing_bet_priced_paired_fold_priced_out`).
3. `pairedBoardRiverCheck`: the bet is priced beside the check (`omahaPricedBet`, the card-impact model, population figures); where EV(bet) is at least EV(check) the bet stands (`plo6_facing_bet_priced_paired_river_bet_kept`), else the check stands by price (`plo6_facing_bet_priced_paired_river_check_priced`).
4. Outermost in the `wager_rules` node (`plo6FacingBetIsPricedRule`): on the flop and the turn a fold becomes the call where the call is priced, so no class ceiling decides a fold (`plo6_facing_bet_priced_called`); a call or raise the brain made is left. On the river the answer is the priced fold, call or raise (`plo6_facing_bet_priced_folded`, `_called`, `_raise_to_call`, `_raised`), preserving nut-end raises (`privateRiverNuts`) and value-live standing calls (`standingRiverCallHolds`).

Validator: `responseValidation.ts` admits the PLO6 fold (or paired-folded raise) to call in `wager_rules` only where the call is priced for the exact chips, re-run on the request with no rake and either position (`plo6FacingBetPricedAdmitsCall`; a superset of what the rule can call), and since review N4 (2026-11-19) only under the decision's own option (`HorseDecisionReceiptContext.plo6FacingBetIsPriced`, `plo6FacingBetIsPricedGateCandidates` in `client.ts`), so a PLO6 fold to call from any other cause is not admitted by this superset. The river raise to call is the existing `plo6RiverRaiseToCall` admission; folds and wagers are admitted as before.

Default OFF in source (read `=== true`). Off (unset, false, a truthy non-boolean) every decision is the one it was, byte for byte (law test).

## Measurement (replay through the serving brain + true opponent six-card holdings, 2026-11-20)

Replayed across all 11,558 PLO6 Horse decisions (`1,650` postflop facing-bet spots across `1,218` hands in `hvh48-audit-01TLQer7J/C/`, seeds `1, 7, 42`, live cash profile, opponent memory off, audit-day switch set):

- **Official 11,558-node `audited-decision-replay.ts` scorer (`plo6` verdict-only):**
  - Before E6/E7/E8 (`#11559`): `fixed 93 / newlyWrong 80` (seed 1, net `+13`), `94 / 82` (seed 7, net `+12`), `95 / 78` (seed 42, net `+17`).
  - With E6 + E7 + E8: **`fixed 87 / newlyWrong 36` (seed 1, net `+51`)**, **`87 / newlyWrong 37` (seed 7, net `+50`)**, **`88 / newlyWrong 37` (seed 42, net `+51`)**, `0` illegal, `0` receipt refusals across all `34,674` arm evaluations. River (`plo6_facing_bet_priced_river_nut_rule_not_run`) improves from `47 fixed / 8-9 newlyWrong` to **`43 fixed / 2 newlyWrong`**, and all 4 river value-jam flattenings (`#59962430`, `#59973676`, `#60055450`, `#59974331`) and the `#60091132` call->fold regression are eliminated (`0` `raise_to_call` newlyWrong).
- **True six-card opponent hole-card EV (`facts.json` across all 1,650 postflop facing-bet nodes):**
  - `fold -> call` net true-card EV improves by **`+494.4 bb`** over `#11511` (`-564.3 bb -> -69.9 bb`), plus `+175.5 bb` preserved on `#59974331` jam and `+129.0 bb` saved folding `#59973335`:
    - **E6 Flop:** HU `fold -> call` (`n = 14`, true equity `0.427` vs price `0.298`) gains **`+227.4 bb`** (up from `+148.0 bb`); MW `fold -> call` bleed cut by `88.9%` (`-183.1 bb -> -20.4 bb`).
    - **E8 Turn:** HU `fold -> call` (`n = 11`, true equity `0.343` vs price `0.306`) gains **`+39.4 bb`**; MW `fold -> call` swings from **`-41.3 bb` (`3/11` good) to `+18.2 bb` (`5/7` good, `71.4%` hit rate)**.
    - **E7 River:** River `fold -> call` true-card loss cut by `46.7%` (`-627.2 bb -> -334.4 bb`) while keeping `43` auditor-verified river fixes against only `2` river `newlyWrong`.

## Not covered

- PLO6 own bets into ranges that only continue with better (audit class 2), preflop (classes 6 and 8), and turn and flop raises (left as the brain makes them).
- The field shares (a caller, an earlier all-in, a player behind) and the bluff priors are the PLO4/PLO5 figures; the value-share translation is STATED. The raise model's fold-to-raise is the minimum-defence population figure (no per-opponent read: the verdict reads no memory so the validator can re-run it).
- The ceilings (V15/V40/V87) still compute inside the brain and shape its call or raise; with the option on they cannot decide a fold.

## Receipts

`plo6_facing_bet_priced_called`, `plo6_facing_bet_priced_folded`, `plo6_facing_bet_priced_raise_to_call`, `plo6_facing_bet_priced_raised`, `plo6_facing_bet_priced_river_nut_rule_not_run`, `plo6_facing_bet_priced_paired_fold_priced_out`, `plo6_facing_bet_priced_paired_river_bet_kept`, `plo6_facing_bet_priced_paired_river_check_priced` (all in `HorseDataLedger.ts`). With the option on, `v58_plo6_river_fold`, `v59_plo6_river_unpaired_fold` and their raise-to-call receipts do not fire in this scope.

## Tests

- `server/src/engine/Plo6FacingBetIsPriced.law.test.ts` (registered in `docs/laws.d/`), on the audit's own hands anonymised (`Plo6FacingBetIsPriced.fixture.json`): red off, green on for #59974054, #59972261, #60060560, #59973455, #60040999, #60067736, #60093920; the river answer is the verdict's for #59974302, #59973335, #60069935, #60074744, #60077887, with no V58/V59 receipt; no facing-bet fold that is not the priced fold over the fixtures and re-dealt river spots (V58/V59 fire on the same spots off); off byte-identical; the receipt validator admits every on decision.
- `server/src/engine/Plo6FlopDefence.law.test.ts` (E6, registered in `docs/laws.d/`): class-fitted two-street barrel tree (`omahaFlopDefenceTreeEv`) heads-up and six-card `6/15` caller concentration + nut-draw quality realization multiway (removal-sensitive).
- `server/src/engine/Plo6RiverDefence.law.test.ts` (E7, registered in `docs/laws.d/`): joint six-card multiway river field (`plo6MultiwayRiverVerdict`), value-domination river guard (`plo6RiverFoldGuardStands`), six-card exact current-nuts river call floor (`plo6RiverCurrentNutsCallSpot`), and nut-end raise / value-live standing call protection (removal-sensitive).
- `server/src/engine/Plo6MultiwayTurnField.law.test.ts` (E8, registered in `docs/laws.d/`): joint disjoint-card six-card river-runout multiway turn field evaluator rescuing high-card nut combo draws and folding dominated underboats (removal-sensitive).

## League

Card `plo6_facing_bet_is_priced` (`server/src/benchmark/HorseLeague.ts` via `npx tsx src/scripts/horseLeagueCard.ts --card=plo6_facing_bet_is_priced --seed=20261120,20261121,20261122`: PLO6, six seats, 100bb cash, mirror field with `productionStyles`, 6,000 duplicate pairs / 12,000 hands per seed; arm A `{"plo6FacingBetIsPriced":true}`, arm B `{}`, `EQUITY_GOVERNOR=off`, archived at `extreme-archive/plo6-audit-01TLQer9Hdf/e6e7e8-evidence-20261120/league_card_out.txt` sha256 `96bec872e9267255438c0ba1837420a7b40347cf3ba7ef5d9234070f4fa1a466`, identical engine source bytes to PR #11578 `f94c25f0ce0598370d78f7b683150af8fb9975aa`):

| seed      | pairs  | hands  | A minus B, bb/100 | standard error (per pair) | block standard error (40 blocks) | divergent pairs | illegal, truncated, corrected, fallbacks |
| --------- | ------ | ------ | ----------------- | ------------------------- | -------------------------------- | --------------- | ---------------------------------------- |
| 20261120  | 6,000  | 12,000 | -0.21             | 4.19                      | 3.79                             | 871             | 0, 0, 0, 0                               |
| 20261121  | 6,000  | 12,000 | +1.29             | 4.22                      | 4.29                             | 955             | 0, 0, 0, 0                               |
| 20261122  | 6,000  | 12,000 | +3.66             | 3.84                      | 3.77                             | 855             | 0, 0, 0, 0                               |
| **All 3** | 18,000 | 36,000 | **+1.58**         | **2.36** (`z = +0.67`)    | -                                | 2,681           | **0, 0, 0, 0**                           |

Because `plo6FacingBetIsPriced` repairs facing-bet folds against human bettors (HVH48 Auditor C), the Horse-only mirror card tests self-play exploitability and harness safety (`+1.58 +/- 2.36 bb/100`, `z = +0.67`, zero illegal/truncated/corrected/fallback actions across `36,000` hands), which is not statistically significant (`|bb/100| <= 2 x stderr`). Per Coordinator ruling (`2026-11-21T05:16:00Z`), this mirror result did not establish `Evidence MET`, and the PLO6 lane declared a follow-up human-field plus mirror evaluation (`eval-40aba893fbc9`, launched `2026-11-21T05:36:26Z`).

### Declared human-field and mirror evaluation (`eval-40aba893fbc9`, 2026-11-21): VALID FAIL

Declaration: `extreme-archive/plo6-audit-01TLQer9Hdf/eval-40aba893fbc9/DECLARATION-PLO6-FACING-BET-IS-PRICED.md` (sha256 `95ca359fb420389e6cc33f79ce52ff6237fd45eff439daa45cebcb0880a048e2`), script `eval_plo6_field.mts` (sha256 `8fb5e35e416dd8d58f3822174c8b82baa6fc63481000960501f7faa2a45e1ca7`), clean tree `40aba893fbc95de9b0519e57c1261e3edcec7d09` (identical engine source to PR `#11578` `f94c25f0ce05`), arm B = live switched set (`prod-switch-20261120T2115Z.json` + `huBbDefendsUnreadToPrice = on`), arm A = arm B + `plo6FacingBetIsPriced: true`, `EQUITY_GOVERNOR=off`. The 400 `F6` sessions completed on launch (`2026-11-21T05:53Z`); the remaining 24 of 100 `M6` sessions (`i = 38..49` and `88..99`) were completed on the exact same clean tree (`2026-11-21T20:18Z`) and aggregated into `RESULT.json` (`valid: true`, `verdict: "FAIL"`).

| cell                                            | sessions | pairs   | hands   | A minus B, bb/100 | standard error | z     | divergent pairs | illegal, truncated, corrected, fallbacks |
| ----------------------------------------------- | -------- | ------- | ------- | ----------------- | -------------- | ----- | --------------- | ---------------------------------------- |
| F6 (`HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`) | 400/400  | 200,000 | 400,000 | -15.510           | 2.655          | -5.84 | 4,173           | 0, 0, 0, 0                               |
| M6 (Horse mirror `productionStyles`)            | 100/100  | 50,000  | 100,000 | +1.483            | 1.319          | +1.12 | 7,237           | 0, 0, 0, 0                               |

- **F6 shape:** Arm B `+41.12 +/- 8.04 bb/100`, Arm A `+25.61 +/- 8.20 bb/100`, `256/400` sessions negative (median `-19.59 bb/100`, Q1 `-51.18`, Q3 `+22.93`, `-7.43 bb` per divergent pair). Bit-for-bit reproduced on sessions `0..5`.
- **Diagnosed root causes (owed before any successor PLO6 facing-bet option is re-proposed):**
  1. `plo6ValueShareAtSameStrength` (`server/src/engine/HorsePlo6ValueShare.ts:139-162`) maps 4-card hand strength onto `C(6,2) = 15`-pair six-card holdings, inflating `valueShare` to `0.55-0.89` on flops, `0.60-0.78` on turns, and `0.42-0.58` on rivers, which also defeats E7's `plo6RiverFoldGuardStands` (`vsValue < 0.15`).
  2. Low-SPR 3-bet/4-bet all-in jams (`potFrac = 0.31-0.41`) fall into `under40`/`mid` stab buckets (`valueShare = 0.71-0.89` with `~40%` bluff prior) while `spot.final = true` bypasses both E6 realization discount and E6's two-street barrel tree.
  3. Request-pure PLO4/PLO5 bluff priors (`bettorRead = null`, `32%-42%` flop / `40%` turn / `15%` river) plus strictly one-way `fold -> call` flop/turn overrides disable `pairedBoardFold` and `plo6RiverNutDiscipline` against value-heavy bettors (consistent with the `-334.4 bb` HVH48 true-card river `fold -> call` bleed vs OFF).
- **Disposition:** `verdict = FAIL` (`z(F6) = -5.84 < -2.0`). `plo6FacingBetIsPriced` remains OFF and is queued for `OPTION_SWITCH_OFF_ONLY` (Turn 4 per PLO-OWNER lead-4 ruling `2026-11-21T19:45:40Z`).

## What the activation row must contain

None while `FAIL` stands: `plo6FacingBetIsPriced` must NOT be activated (`on` or `shadow`) and is locked in `OPTION_SWITCH_OFF_ONLY` (`state = 'off'` only) in Turn 5. Lifting the lock requires fixing the three root causes above, re-declaring and passing both human-field and mirror evaluations alongside audited replay, and updating this authority file.

## Rollback

- Locked `off-only` (`OPTION_SWITCH_OFF_ONLY`, status `harm`) in both the engine registry and the Turn 5 database switch-list migration (`20261122181616_horse_option_switch_turn5_antigravity_train.sql`): `on`, `shadow`, and `on_shadow` are refused at the parser, registry, and database CHECK constraint levels.
- If any legacy row ever existed, `fn_ca_horse_option_switch_set('plo6FacingBetIsPriced', 'off', ...)` (or the `horse-option-switch` CLI) enforces `off` across all live workers within ~30s with zero data migration.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited. The three rows below are the scorer's output for this file, unedited.

- Replay: fixed 87; newlyWrong 36; changed 153; unchanged 10025; unjudged 30; set HVH48 auditor C PLO6 seed 1; scorer 2752840674e; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558
- Replay: fixed 87; newlyWrong 37; changed 152; unchanged 10026; unjudged 28; set HVH48 auditor C PLO6 seed 7; scorer 2752840674e; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558
- Replay: fixed 88; newlyWrong 37; changed 152; unchanged 10026; unjudged 27; set HVH48 auditor C PLO6 seed 42; scorer 2752840674e; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558

How the row is produced (run from `server/` on the operations Mac; `C` is `/Volumes/SmarterWork/agent-work/shared-capacity/hvh48-audit-01TLQer7J/C`, the audit's `decisions.csv`, `meta.jsonl` and `hands.jsonl`; the layout and the verdict mapping are in `README.md`, "The PLO6 audit set").

1. `npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl --emit-nodes plo6-nodes.jsonl`
2. The auditor's harness (`plo6_arm_replay.ts`, derived from `hvhC_replay.ts`, keeping voluntary actions in `actionHistory`) re-decides every emitted node with the production switch set of the audit day (`plo6FacingBetIsPriced` off vs on) and checks `horseDecisionReceiptRefusal` and action legality on every node (`0` illegal, `0` refused).
3. Per seed (`1, 7, 42`): `npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl --replay ours-replay-seed1.jsonl --line on --row on --set "HVH48 auditor C PLO6 seed 1"`, and the printed `- Replay:` row is copied here unedited.
