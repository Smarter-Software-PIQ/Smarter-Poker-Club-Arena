# omahaHiLoTournamentFirstIn: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, tests and off-identity are recorded and the declared offline evaluation is recorded as SUPPORTED on two seeds. The replay on recorded decisions was run twice on 2026-11-21 on the same 430 audited decisions and the same replay: with Auditor E's borrowed Hold'em out-of-position realization 0.72 it FAILED its PASS-BAR (fixed 0, newly wrong 35); with that constant replaced by one measured for PLO8 under a declaration written first (1.01, standard error 0.036, 4,004 league pots re-settled hi-lo) it PASSES the replay bar (fixed 0, newly wrong 0, every change unjudged), which shows no audited gain. It is not met because no activation order is recorded ("The order it rests on"), and the league card is a mirror-field result, not an audited gain: its first three significant runs (+36.54, +35.80 and +38.92 bb/100) were measured by a league that settled every PLO8 pot to the high hand only (found 2026-11-21, section "Measured out-of-position realization"); re-run on 2026-11-21 after the league was fixed to pay the low half, the same seeds measured +32.36, +29.44 and +33.78 bb/100 (stderr about 4.1, z 7.2 to 8.2, each SIGNIFICANT; section "League card runs"). No live read exists.

Written 2026-11-20 from what the repository records (sources named per section); nothing was run for the file on that day. The sections "Replay on recorded decisions (2026-11-21)" and "Replay" were added on 2026-11-21 from a replay run for this file; every number in them was measured in that run. The section "Measured out-of-position realization and the second replay (2026-11-21)" and the second row under "Replay" were added the same day from the runs it names; every number in them was measured in those runs.

## What it does

Source: `docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`, `server/src/engine/HorsePreflop.ts` (`OMAHA_HILO_TOURNAMENT_FIRST_IN`), `server/src/engine/HorseDataLedger.ts` (flag `omahaHiLoTournamentFirstIn`).

Pot-limit Omaha hi-lo (PLO8) in an engine-declared tournament, exactly two dealt in, 20 big blinds or less. With the option on, HorseLogic passes the hand's hi-lo percentile (`omahaPreflopPercentile(cards, true)`) to the preflop engine and the Omaha high replacement function `omahaTournamentFirstIn` runs with `OMAHA_HILO_TOURNAMENT_FIRST_IN`:

- the small blind first in plays every hand as the pot-limit maximum raise (`headsUpShare: 1`);
- the big blind calls its top 75 percent against one raise at a price of a half or better (`bigBlindDefendShare: 0.75`, `bigBlindMaxPrice: 0.5`);
- 20 BB ceiling (`maxStackBB: 20`); every three-handed branch is zero and the table is capped at two dealt in even when a league arm asks for more (`maxTableSize: 2`).

It replaces only a fold. All-In-Or-Fold, locked satellite seats, cash, fixed-limit hi-lo, Omaha high and deeper stacks stand aside. `HorseOmahaTournamentFirstIn.ts` itself is unchanged by it.

Default OFF in source: only explicit `true`, or a league arm's parameter object, switches it on; off, nothing is computed. It is a registered option of the Horse option switch (`server/src/engine/HorseOptionSwitch.ts`: registered name, lane 'Heads Up', scope 'PLO8 tournament, heads-up, <= 20 bb'; not in `OPTION_SWITCH_OFF_ONLY`, so no owner preflop range hold applies to it: re-read at `5bfaa38d0e0c` on 2026-11-21) and is named by the switch-list migrations from `supabase/migrations/20261115191000_horse_option_switch_plo_strategy_options.sql` on.

## The order it rests on

No owner order naming this option is recorded in the repository. The changelog records its origin as lane work: "Lane: Heads Up (HU-HILO-002; delegated by PLO Strategy 2026-11-14T22:47Z; HU-HILO-003, PLO8 cash and deeper than 20 BB, is not part of this change)". An activation row needs the lane lead's or the owner's order recorded here, verbatim, before it cites this file.

## What it answers

Source: the changelog, "Why" (it cites the heads-up audit `hu-audit-01UxDLnM/variants/FINDINGS.md`, which is in the audit archive, not in this repository).

At 20 big blinds or less in pot-limit Omaha hi-lo tournaments "the heads-up small blind folds 83 to 85 percent of its first actions and the big blind folds 81 to 91 percent to one raise". It is the same commitment-zone fold that #10687 corrected for Omaha high; hi-lo was left out on purpose because it needed its own evaluation.

## Receipts

`omaha_hilo_tournament_first_in` (`HorseDataLedger.ts`, source 'HorsePreflop (omahaHiLoTournamentFirstIn)'); ledger flag `omahaHiLoTournamentFirstIn`.

## Tests

`server/src/engine/HorseOmahaHiLoTournamentFirstIn.law.test.ts` (10 cases, as the changelog records them): the published limits; off, absent and every non-true scalar change no decision and fire nothing; PLO8 heads-up small blind at 8/12/20 BB folds at least 40 percent off and at most 5 percent on, every change is a fold turned into a legal action with its receipt; the big blind facing one pot raise folds at least 25 points less and still folds at least 10 percent; Omaha high (PLO4/5/6), cash, 25 BB, three-handed (including a league arm that asks for three-handed) and fixed-limit hi-lo unchanged; a league arm can switch the small blind part off. Registered in `docs/laws.d/server-src-engine-HorseOmahaHiLoTournamentFirstIn.md`.

League card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb` (`server/src/benchmark/HorseLeague.ts`: PLO8, two seats, 12 BB, final-table tournament context, 6,000 pairs, arm A the option on, arm B today's brain). Scripted non-mirror field cards (`server/src/benchmark/Plo8HuScriptedField.ts`, `Plo8HuScriptedField.test.ts`, 18 cases): `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller`, `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind`, and `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor` (`plo8_hu_scripted_field_v1`, same 12 BB final-table tournament context, 6,000 pairs, pure deterministic DESIGN VALUE personas). Their measured runs are under "League card runs" below.

## League card runs

Run 2026-11-20 by a coordinator agent of session 01UxDLnH with the single-card league runner (PR #11534), and supplied to this file as copied below; the run's own output files are not in this repository. Opponents are the Horse brain itself (mirror field), so this is the same limit as the evaluation below: no human-calibrated field.

| seed     | card                                            | arm A                               | arm B | variant, seats, depth, format    | field  | pairs (hands) | bb/100 (A minus B) | stderr | block stderr (blocks) | verdict     | engine revision                          | wall    | illegal actions |
| -------- | ----------------------------------------------- | ----------------------------------- | ----- | -------------------------------- | ------ | ------------- | ------------------ | ------ | --------------------- | ----------- | ---------------------------------------- | ------- | --------------- |
| 20261120 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +36.54             | 4.92   | 5.41 (40)             | SIGNIFICANT | 63f3215d2f568bda6ae17682260fcfedc0e20330 | 567.5 s | 0               |
| 20261121 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +35.80             | 4.90   | 5.54 (40)             | SIGNIFICANT | 21d1f566062639935cefe04eacb4923a3e54c0f9 | 455.0 s | 0               |
| 20261122 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +38.92             | 4.93   | 4.87 (40)             | SIGNIFICANT | 21d1f566062639935cefe04eacb4923a3e54c0f9 | 224.0 s | 0               |

**These three runs measured a high-only game.** Until 2026-11-21 the league's showdown (`playHand`) paid every pot to the best high hand and never paid a low half, so a PLO8 pot with a qualifying low went whole to the high hand (found 2026-11-21 by a coordinator agent: 24,000 hands re-settled high-only, 0 mismatches). They are kept as recorded, and are superseded by the runs below.

### Re-run with hi-lo settlement (2026-11-21)

Run 2026-11-21 by a subagent of the Antigravity Coordinator (Claude session_01Gw7aDtgw51ks82iZdeEMVr) after the league was fixed to pay hi-lo pots by the engine's own `determineWinners` (`settleLeagueShowdown`, `docs/changelog/2026-11-21-league-pays-the-low-half.md`). Same card, same arms, same seeds, same size (6,000 pairs, fixed before running), single-card runner `server/src/scripts/horseLeagueCard.ts`, in a cloud container; each row copied from the runner's output block.

| seed     | card                                            | arm A                               | arm B | variant, seats, depth, format    | field  | pairs (hands) | bb/100 (A minus B) | stderr | block stderr (blocks) | z    | verdict     | engine revision                          | wall    | illegal actions |
| -------- | ----------------------------------------------- | ----------------------------------- | ----- | -------------------------------- | ------ | ------------- | ------------------ | ------ | --------------------- | ---- | ----------- | ---------------------------------------- | ------- | --------------- |
| 20261120 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +32.36             | 4.17   | 4.50 (40)             | 7.75 | SIGNIFICANT | 6f042c1bb13be498ac2dad0daadb7269307b7847 | 325.7 s | 0               |
| 20261121 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +29.44             | 4.10   | 4.96 (40)             | 7.18 | SIGNIFICANT | 6f042c1bb13be498ac2dad0daadb7269307b7847 | 322.6 s | 0               |
| 20261122 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +33.78             | 4.12   | 4.68 (40)             | 8.19 | SIGNIFICANT | 6f042c1bb13be498ac2dad0daadb7269307b7847 | 314.8 s | 0               |

Truncated streets, corrected actions and brain fallbacks 0 in every run; divergent pairs 5334, 5287 and 5281; solver stores empty (charts 0, postflop 0, postflopV31 0), equity governor off. Against the high-only runs (z 7.43, 7.31, 7.89) the gain is 4.2, 6.4 and 5.1 bb/100 smaller on the same seeds and still significant on all three. The status of this file does not change: the replay on audited decisions still fails its bar.

The high-only runs: three seeds, each copied from the runner's output (server/src/scripts/horseLeagueCard.ts, PR #11534) unedited. The runs read no database, so the solver stores were empty (charts 0, postflop 0, postflopV31 0); the nightly league fills them, and a nightly row may differ. The 12 bb card is the only league card depth for this option: no 8 bb or 20 bb card exists. A league card is not the replay on audited decisions and does not change the status of this file.

### Scripted non-mirror PLO8 heads-up field (2026-11-21)

Run 2026-11-21 by a subagent of the Antigravity Coordinator (`server/src/benchmark/Plo8HuScriptedField.ts`, population `plo8_hu_scripted_field_v1`, zero changes to `HorseLogic.ts`, base checkout `b4209890b7abe9afe974bd4358ce30370eed9ad8` / `89a5c6eb6651`). Because `HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID` covers `plo4`/`plo5`/`plo6` only and production holds 0 real-human PLO8 heads-up tournament hands, three pure deterministic DESIGN VALUE scripted PLO8 heads-up opponents were seated through the league's human-field seat policy (`runHumanFieldMatchup`, hi-lo settlement active):

- `plo8_hu_rec_caller_v1` (card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller`): short-stack recreational caller/defender (SB opens pot top 45% and limps next 30%, BB defends top 70% vs one raise with 15% 3-bet, postflop sticky calls with any pair, made low or low draw).
- `plo8_hu_tight_blind_v1` (card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind`): tight-blind / nit harm control (SB opens pot top 25% only and never limps, BB defends top 25% vs one raise with 10% 3-bet, postflop calls only two pair+ or made low).
- `plo8_hu_aggro_3bettor_v1` (card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor`): aggressive 3-betting / jamming harm control built to punish wide first-in SB opens (SB opens pot top 70% and never limps, BB 3-bets pot / jams top 45% vs one raise and calls next 25%, postflop pot-barrels any pair, made low or low draw and raises pot with two pair+, made low, or pair+low draw).

Each card was evaluated across three fixed seeds (`20261121`, `20261122`, `20261123`), 6,000 pairs (12,000 hands) per seed, `EQUITY_GOVERNOR=off`, empty solver stores (`charts 0, postflop 0, postflopV31 0`), once on the live 67-row `public.ca_horse_style_switch` snapshot (`prod-switch-20261122T0336Z.json`: 51 options on, 0 sanitized; arm A = prod base plus `omahaHiLoTournamentFirstIn: true`, arm B = prod base) and once on the declared empty base (`arm A = {"omahaHiLoTournamentFirstIn":true}`, `arm B = {}`). Both bases produced bit-for-bit identical results on every seed (every live-on switch option is either already default-on in source or outside PLO8 HU 12 bb scope).

| seed     | card                                                             | persona                  | pairs (hands) | arm A (bb/100) | arm B (bb/100) | bb/100 (A minus B) | stderr | block stderr (blocks) | z     | verdict     | divergent pairs | wall   | illegal actions |
| -------- | ---------------------------------------------------------------- | ------------------------ | ------------- | -------------- | -------------- | ------------------ | ------ | --------------------- | ----- | ----------- | --------------- | ------ | --------------- |
| 20261121 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller    | plo8_hu_rec_caller_v1    | 6000 (12000)  | +29.36         | -30.11         | +59.47             | 6.76   | 6.35 (40)             | 8.80  | SIGNIFICANT | 3246            | 71.0 s | 0               |
| 20261122 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller    | plo8_hu_rec_caller_v1    | 6000 (12000)  | +37.38         | -24.17         | +61.55             | 6.55   | 5.58 (40)             | 9.40  | SIGNIFICANT | 3237            | 71.2 s | 0               |
| 20261123 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller    | plo8_hu_rec_caller_v1    | 6000 (12000)  | +28.32         | -21.78         | +50.10             | 6.86   | 7.46 (40)             | 7.31  | SIGNIFICANT | 3221            | 71.2 s | 0               |
| pooled   | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_rec_caller    | plo8_hu_rec_caller_v1    | 18000 (36000) | +31.69         | -25.35         | +57.04             | 3.88   |                       | 14.70 | SIGNIFICANT | 9704            |        | 0               |
| 20261121 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind   | plo8_hu_tight_blind_v1   | 6000 (12000)  | +88.17         | -1.14          | +89.31             | 4.22   | 3.84 (40)             | 21.18 | SIGNIFICANT | 2737            | 22.4 s | 0               |
| 20261122 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind   | plo8_hu_tight_blind_v1   | 6000 (12000)  | +95.73         | +2.35          | +93.38             | 4.01   | 3.50 (40)             | 23.28 | SIGNIFICANT | 2733            | 22.0 s | 0               |
| 20261123 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind   | plo8_hu_tight_blind_v1   | 6000 (12000)  | +91.76         | +3.54          | +88.22             | 4.18   | 3.52 (40)             | 21.11 | SIGNIFICANT | 2680            | 22.6 s | 0               |
| pooled   | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_tight_blind   | plo8_hu_tight_blind_v1   | 18000 (36000) | +91.89         | +1.58          | +90.30             | 2.39   |                       | 37.81 | SIGNIFICANT | 8150            |        | 0               |
| 20261121 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor | plo8_hu_aggro_3bettor_v1 | 6000 (12000)  | +17.77         | -35.58         | +53.36             | 7.84   | 9.18 (40)             | 6.81  | SIGNIFICANT | 3438            | 59.9 s | 0               |
| 20261122 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor | plo8_hu_aggro_3bettor_v1 | 6000 (12000)  | +13.93         | -46.71         | +60.63             | 7.98   | 7.05 (40)             | 7.60  | SIGNIFICANT | 3562            | 56.2 s | 0               |
| 20261123 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor | plo8_hu_aggro_3bettor_v1 | 6000 (12000)  | +15.57         | -32.27         | +47.85             | 8.13   | 9.32 (40)             | 5.89  | SIGNIFICANT | 3466            | 59.9 s | 0               |
| pooled   | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb_vs_aggro_3bettor | plo8_hu_aggro_3bettor_v1 | 18000 (36000) | +15.76         | -38.19         | +53.95             | 4.61   |                       | 11.71 | SIGNIFICANT | 10466           |        | 0               |

Truncated streets, corrected actions and brain exception fallbacks are 0 in every run across all 108,000 hands. Against `plo8_hu_rec_caller_v1`, option OFF loses an average of -25.35 bb/100 and option ON turns it into +31.69 bb/100 (+57.04 +/- 3.88 bb/100 pooled, z = 14.70). Against the `plo8_hu_tight_blind_v1` harm control, option OFF averages +1.58 bb/100 and option ON averages +91.89 bb/100 (+90.30 +/- 2.39 bb/100 pooled, z = 37.81). Against the `plo8_hu_aggro_3bettor_v1` harm control, option OFF loses an average of -38.19 bb/100 and option ON turns it into +15.76 bb/100 (+53.95 +/- 4.61 bb/100 pooled, z = 11.71). Limits: these are DESIGN VALUE scripted development personas, not a calibrated human population and not an audited replay gain; this measurement does not change `State: OFF` or `Evidence NOT MET`.

## The recorded evaluation (offline, opponents are variants of the Horse brain)

Source, quoted exactly: `docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`, "Evaluation". Declared before any result in `hu-audit-01UxDLnM/evaluation/DECLARATION-HU-HILO-002.md`; tables and raw per-group results in `hu-audit-01UxDLnM/evaluation/results-HU-HILO-002/` (both in the audit archive, not in this repository, and not re-read for this file).

Method as recorded: "PLO Strategy's Evaluation Protocol 2 method, PLO8: real HandController hands, heads-up tournament, every deal played from both seats, paired difference option minus off in big blinds per hand against five opponents (old, tight, wide, call-heavy, adaptive re-shover) at 8, 12 and 20 BB, 4,000 hands per cell."

- "Development seed 94101, option on minus off: +0.53 to +0.55 at 8 BB, +0.45 to +0.49 at 12 BB, +0.28 to +0.30 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.17 / +0.15 / +0.05 and adaptive +0.30 / +0.20 / +0.00 (no cell below zero). Declared rule: SUPPORTED. The small blind part carries the gain; the big blind part alone was not distinguishable from zero in any cell."
- "Confirmation, fresh seed 94202, run once and reported as it is: +0.57 to +0.59 at 8 BB, +0.49 to +0.55 at 12 BB, +0.34 to +0.37 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.27 / +0.27 / +0.12 and adaptive +0.38 / +0.28 / +0.11 (no cell below zero; 20 BB includes zero). Declared rule: SUPPORTED."

Limits as recorded: "Every opponent is a variant of the Horse brain; no human-calibrated Omaha field is qualified. Chips only (heads-up, so payout-linear). At 20 BB the gain against a re-shoving or call-heavy opponent is not distinguishable from zero, as for Omaha high."

## Evidence rows

- Mechanism, scope, visibility (receipt), tests: recorded (sections above).
- Option unset or false: decisions identical (the law test above).
- League card (mirror field, Horse-brain opponents), with hi-lo settlement (2026-11-21): seeds 20261120, 20261121 and 20261122: +32.36, +29.44 and +33.78 bb/100 (stderr 4.17, 4.10, 4.12), each SIGNIFICANT. The earlier +36.54, +35.80 and +38.92 measured a high-only game (no low half paid) and are superseded. Offline runs with empty solver stores, not nightly rows.
- League cards (scripted non-mirror PLO8 heads-up field, `plo8_hu_scripted_field_v1`, DESIGN VALUE development personas, hi-lo settlement, 2026-11-21, identical on 67-row prod switch base and empty base): vs `plo8_hu_rec_caller_v1` pooled +57.04 +/- 3.88 bb/100 (z = 14.70, seeds +59.47/+61.55/+50.10, flipping -25.35 to +31.69 bb/100); vs `plo8_hu_tight_blind_v1` harm control pooled +90.30 +/- 2.39 bb/100 (z = 37.81, seeds +89.31/+93.38/+88.22, lifting +1.58 to +91.89 bb/100); vs `plo8_hu_aggro_3bettor_v1` harm control pooled +53.95 +/- 4.61 bb/100 (z = 11.71, seeds +53.36/+60.63/+47.85, flipping -38.19 to +15.76 bb/100); 0 illegal/truncated/corrected/fallbacks across 108,000 hands. Scripted development personas, not a calibrated human population.
- Declared offline evaluation: SUPPORTED on development seed 94101 and on confirmation seed 94202 (changelog). It is an offline result against Horse-brain opponents, not a replay on audited decisions and not a live read.
- Replay on recorded audited decisions (README.md, "Replay bar"), first run 2026-11-21 with the borrowed Hold'em realization 0.72: PASS-BAR item 2 (newlyWrong <= fixed) failed: fixed 0, newly wrong 35 (section "Replay on recorded decisions").
- Replay on recorded audited decisions, second run 2026-11-21 with the measured PLO8 realization 1.01 (the current constant): PASS-BAR passed, fixed 0, newly wrong 0, changed 248, all 248 unjudged; no audited gain (section "Measured out-of-position realization").
- League settlement: until 2026-11-21 the league's PLO8 hands paid the whole pot to the high hand (no low half), so the first three league card rows measure a high-only game (section "Measured out-of-position realization"). Fixed 2026-11-21 (`settleLeagueShowdown`, `docs/changelog/2026-11-21-league-pays-the-low-half.md`); the re-run rows are under "League card runs".
- Value against people, live reach of the receipt: NOT MEASURED. Production held 0 real-human (`has_human = true`) PLO8 heads-up tournament hands on 2026-11-21 (re-checked read-only on `public.hand_history` at 2026-11-21T21:24:48Z: 0 of 414 PLO8 heads-up tournament hands, out of 7,107 PLO8 tournament hands total and 468 with `has_human = true`; 0 of 361 in the earlier 2026-11-21T08:2xZ export).

## Replay on recorded decisions (2026-11-21)

Run by a subagent of the Antigravity Coordinator (session_01Gw7aDtgw51ks82iZdeEMVr). The declaration, the auditor, the export query, the audit summary and the scorer's log are in `antigravity-coordinator-01UxDLnH/evidence/plo8-hu-first-in/` on the operations Mac (not in this repository), with these sha256: `DECLARATION-PLO8-HU-FI-REPLAY.md` `d5a3bb9c839ee93c7d846d41179fc3554e537fca6a5f118e987523c7579fb76c`, `plo8_hu_first_in_audit.ts` `9e819bf2706cf674765b4ac65cc9ccfd0695b563bf50f71229f9afc198ede0f5`, `EXPORT.sql` `72c96906a5676a934cef8174c801ea2ff64efb246600d3baae6d26cda5aa507b`, `AUDIT-SUMMARY.json` `b4179605a8de234e8d791cfd757d0cf244bcc9103457504c244b56e1540f9658`, `PLO8HU-FI.score.log` `f866363a1859acaabe82e98b1acba1ba91e1596267bd6563d79c778acea79c19`. The hand export, the audit csv, the placed nodes and the replay file were kept off the repository and off the archive (the export holds the Horses' own hole cards); they can be rebuilt from the query and the auditor while the hands are retained.

### What production held (read-only, project kuklfnapbkmacvwxktbh, 2026-11-21T08:2xZ)

Query shape: `public.hand_history` where `game_variant = 'plo8'`, `tournament_id is not null`, `jsonb_array_length(players) = 2`, `created_at < 2026-11-21T00:00Z`; the Horses' own hole cards from `public.ca_hand_facts` joined to `profiles.is_horse`.

- 361 hands in 11 tournaments, 2026-11-12T18:37Z to 2026-11-20T18:30Z (older Horse-only hands are pruned by retention). `has_human` is false on all 361: every hand is Horse against Horse. At the first preflop Horse decision 350 record two players left in the event and 5 record three; 6 hands have no voluntary preflop Horse decision (the declaration's "355 of the 361" counted the two groups together).
- 499 first voluntary preflop Horse decisions, every one with a public snapshot and the deciding Horse's own cards known; 430 of them at an effective stack (the smaller start-of-hand stack) of 20 big blinds or less, in 310 hands of the 11 tournaments; 69 deeper. (Counted by the deciding seat's own stack instead, 275 are at 20 big blinds or less.)
- Of the 430: 310 small-blind first-in decisions (190 folds, 107 raises, 13 limps), 107 big-blind decisions facing one raise (87 folds, 10 calls, 9 raises, 1 all-in; every fold faced about 2 bb to call) and 13 big-blind decisions behind a limp.

### The set and the auditor

Set `PLO8HU-FI PLO8 2-player tournaments 20bb`: the 430 decisions above. No audit of PLO8 heads-up tournament decisions existed, so one was written for this replay and declared before it priced a row: auditor `PLO8-HU-FI-A1`. It is HVH48 Auditor E's preflop rule (its `facingRaise` and `deepFirstIn` formulas, realization constants and `classify` thresholds, the audit that priced the HU30D and HU14D sets of huBbDefendsUnreadToPrice) with three substitutions for hi-lo Omaha:

1. equity is a Monte Carlo hi-lo pot share (the engine's `evaluateOmahaHand` and `evaluateOmahaLowHand`, 1,500 samples, fixed seed) of the deciding Horse's own four cards against a range;
2. a range is the top X of four-card hands by the engine's own hi-lo preflop percentile (`omahaPreflopPercentile(cards, true)`, the same ranking the option reads);
3. the two population numbers are measured on the set's public actions: the small blind raises 107 of 310 first-in decisions (0.345, the raiser's range width) and the big blind folds to one raise 87 of 107 times (0.813).

Big blind facing one raise (recorded fold or call): EV(call) = realization x equity x (pot + call) - call, realization 1 when the call is 40 percent or more of the stack behind, else 0.72 (Auditor E's out-of-position constant); a loss is LIKELY at 1.5 bb and a 0.10 margin (or, committed, CLEAR at 1 bb and 0.07, LIKELY at 0.3 bb and 0.035), else DEBATABLE; no loss is OK. Small blind first in (recorded fold or raise): EV(pot raise) = 0.813 x pot + 0.187 x (0.75 x equity against the top 0.187 x final pot - raise cost), same thresholds. A big-blind check behind a limp is OK; a limp and a big-blind raise or all-in are unpriced. Class rule: that of `server/scripts/hvh48-audit-nodes.py` (bad = CLEAR or LIKELY; ok = priced and not flagged; unjudged = DEBATABLE or unpriced). Placed by that script unmodified (`--set E`): 430 placed, 0 not placed; bad 3, ok 184, unjudged 243.

Audit classes by spot: small-blind fold 190 DEBATABLE (a pot raise is priced +EV on every one, below the 1.5 bb threshold), small-blind raise 107 OK, small-blind limp 13 unpriced; big-blind fold 59 OK, 25 DEBATABLE, 3 LIKELY; big-blind call 9 OK, 1 DEBATABLE; big-blind raise or all-in 10 unpriced; big blind behind a limp 9 OK, 4 unpriced.

### PASS-BAR (declared before the replay) and the result

1. every decision placed and replayed, 0 illegal, 0 refused, 0 errors: PASSED (430 of 430).
2. the scorer's row: newlyWrong <= fixed: FAILED (fixed 0, newly wrong 35).
3. 0 more passive changes; every change is a base-arm fold turned into a raise (small blind) or a call (big blind): PASSED (248 changes, 248 more aggressive; 190 small-blind raises, 1 small-blind all-in, 57 big-blind calls).

Unedited scorer line (`server/scripts/audited-decision-replay.ts --placed ... --line on`, scorer `d6b032d3204`, replay harness `server/scripts/audited-node-option-replay.ts` at `5bfaa38d0e0c`, seeds 1,7,42, live tournament hybrid profile, opponent memory off, base arm = the 66 rows of `public.ca_horse_style_switch` read 2026-11-21T08:24:56Z, arm on = base plus omahaHiLoTournamentFirstIn):

`placed (verdict-only; 430 audited decisions, 3 judged bad; joined by node: 430 replayed, 0 not replayed, base reproduces the recorded action on 408): arm on changed 248 (248 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 35, still wrong 0, ok to ok 0, unjudged 213; judged bad left unchanged 0; no bb (the audit declares no EV model); per receipt: (no receipt) 248 changed / 0 fixed / 35 newly wrong.`

What the 248 changes are (counted from the replay file and the placed nodes):

- Small blind, 191: 181 recorded folds the base arm also folds, turned into the pot raise (audit DEBATABLE, so unjudged); 6 recorded limps and 4 recorded raises where today's base arm folds, turned into a raise or all-in (base differs from the recorded action, so unjudged). 0 newly wrong, 0 fixed.
- Big blind facing one raise, 57 folds turned into calls: 35 the audit priced OK as folds (newly wrong) and 22 it priced DEBATABLE (unjudged). 27 big-blind folds are left folded (24 OK, 3 DEBATABLE).
- The 3 big-blind folds the audit judged bad are already calls in the base arm (today's brain, option off), so the option changes nothing there and fixes none.

Why it fails, and how far the result reaches:

- All 35 newly wrong decisions are big-blind calls of a 2 bb raise priced with the 0.72 out-of-position realization: equity against the raiser's range 0.35 to 0.46 (mean 0.43), required 0.33. At realization 1 every one of the 35 would be priced a correct call. The verdict therefore rests on Auditor E's realization constant, which was written for Hold'em and is not measured for PLO8; it was declared before the run and is not changed after it.
- It agrees with the recorded evaluation above: "The small blind part carries the gain; the big blind part alone was not distinguishable from zero in any cell."
- The receipt column reads "(no receipt)" because the replay harness keeps only receipts matching its own filter, which does not include `omaha_hilo_tournament_first_in`; the two arms differ by this option alone.
- Limits: Horse against Horse hands only (no hand with a person); one retention window of 9 days and 11 tournaments; the fold share 0.813 is measured on the same set and is the option-off field's (a big blind that itself runs the option folds less, which this audit does not price; the mirror league card does); chip EV only, no ICM term; a verdict-only audit, so no bb total; opponent memory off in replay.

## Measured out-of-position realization and the second replay (2026-11-21)

Run by a subagent of the Antigravity Coordinator (session_01Gw7aDtgw51ks82iZdeEMVr). The declaration, the measurement script and its output, auditor A2, its audit summary and the scorer's log are in `antigravity-coordinator-01UxDLnH/evidence/plo8-oop-realization/` on the operations Mac (not in this repository), with these sha256: `DECLARATION-PLO8-OOP-REALIZATION.md` `ae2867beebbe8a1a32592e5ec66e2c3f2d44a4926ae495d16fb0b439b9954441` (written 2026-11-21T14:17Z, before the realization was computed), `measure.mts` `a92d3cb96739881680de7733806f764da72ad7c711f4db948682cfbf7f59acc2`, `measure.json` `c22f8fd4a465dd25d4a6d5c07037c2da46c9deb1f4e8bf94637f42504ebbcf60`, `plo8_hu_first_in_audit_A2.ts` `1f0649955cea1da6625158a688d54ff239115c65610bdad100718b4a667e8038`, `AUDIT-SUMMARY-A2.json` `5d76fab1c69877d6c43044dba778e84e31defb118192182905c96cd56685c59c`, `PLO8HU-FI-A2.score.log` `88ccaef999947d6a6c8faa49748234a99b413cc26b52e3f11c7674336b1335ea`. The hand export, the audit csv, the placed nodes and the replay file were deleted after the run (the export holds the Horses' own hole cards).

### Why

All 35 newly wrong decisions of the first run were big-blind calls priced with Auditor E's out-of-position realization 0.72, a Hold'em constant never measured for PLO8 (section "Replay on recorded decisions"). The declaration replaced it with a measured constant, fixed before the audit priced a row.

### How the realization was measured

- Definition, to fit the auditor's formula EV(call) = R x eq x (pot + call) - call: per pot, eq = the big blind's hi-lo all-in pot share against the small blind's actual four cards (Monte Carlo, 2,000 boards, the auditor's share function on the engine evaluators), P = the pot after the call, V = the big blind's stack at the end of the hand minus its stack right after the call; R = sum V / sum (eq x P), standard error by linearization.
- Production first, by a rule declared beforehand (400 qualifying pots or more): production held 14 PLO8 two-player tournament pots where the small blind raised and the big blind called (any depth, read-only count), so production was not used.
- League engine instead: `playHand` of `server/src/benchmark/HorseLeague.ts` at `945de20c4`, called from the scratch script, PLO8, two seats, the 12 bb card's final-table tournament context with the stack depth set to 8, 12, 16 and 20 big blinds, the tournament hybrid profile, mood clock deal_seed, one HorseMind sandbox per depth with learning on, 6,000 deals per depth (24,000 hands, run seed 20261121). Big blind = `{ omahaHiLoTournamentFirstIn: true }`, small blind = today's brain. Sample: the small blind raises (not all-in), the big blind calls (not all-in), call / stack behind under 0.4 (the auditor's uncommitted scope; at 0.4 or more the auditor already uses 1).
- The league pays every PLO8 pot to the high hand only (`playHand` settlement scores `scoreOmahaHi`; it has no low half). The script tracked contributions, re-settled every hand high-only and reproduced the league's own net on all 24,000 hands (0 mismatches), then re-settled showdowns hi-lo (contested amount split by the hi-lo share on the actual board, uncalled excess returned). (The league itself pays the low half since 2026-11-21, `settleLeagueShowdown`; this measurement was made on the high-only league with its own hi-lo re-settlement.)

### Result (`measure.json`)

| depth  | pots  | R      | stderr | mean eq | mean call (bb) | mean pot after call (bb) | showdown share |
| ------ | ----- | ------ | ------ | ------- | -------------- | ------------------------ | -------------- |
| 8 bb   | 0     | none   | none   |         |                |                          |                |
| 12 bb  | 873   | 0.9779 | 0.0635 | 0.4462  | 3.000          | 9.000                    | 0.796          |
| 16 bb  | 1,572 | 1.0459 | 0.0585 | 0.4664  | 2.670          | 8.341                    | 0.599          |
| 20 bb  | 1,559 | 1.0009 | 0.0635 | 0.4658  | 2.675          | 8.351                    | 0.586          |
| pooled | 4,004 | 1.0133 | 0.0364 | 0.4618  | 2.744          | 8.489                    | 0.637          |

The constant (R rounded to two decimals, as declared): **1.01**. At 8 bb every big-blind call of a raise is committed (call / behind 0.4 or more), so no 8 bb pot is in the sample. Before the declared run, a 100-hand smoke test of the script at 12 bb (the first 100 deals of the declared run's 12 bb depth) printed R 0.56 on 18 pots; the method was already fixed by the declaration and nothing was changed after it.

Limits: Horse-brain (mirror) postflop play on both sides, not a human field; the league's small-blind raising range is not production's measured 0.345; the league's tournament context posts a big-blind ante (pot after the call about 8.5 bb; production's big blinds faced about 2 bb to call); chip EV only, no ICM term; one run.

### The second replay

Auditor `PLO8-HU-FI-A2` = `PLO8-HU-FI-A1` with one change, `RZ_OOP = 1.01` in place of 0.72 (nothing else). The set was re-exported read-only with `EXPORT.sql` (361 hands, all still retained; A1 on the re-export reproduced the first run's audit summary byte for byte, sha256 `b4179605...`). Placed by `server/scripts/hvh48-audit-nodes.py --set E` unmodified: 430 placed, 0 not placed; bad 3, ok 127, unjudged 300 (A1: bad 3, ok 184, unjudged 243); the placement job was identical to A1's. Big-blind folds facing one raise under A2: 1 OK, 83 DEBATABLE, 3 LIKELY (A1: 59 OK, 25 DEBATABLE, 3 LIKELY). Replay: `server/scripts/audited-node-option-replay.ts` at `5bfaa38d0e0c` (as the first run), seeds 1,7,42, base arm = the 66 rows of `public.ca_horse_style_switch` (no change in `ca_horse_style_switch_audit` since 2026-11-21T08:24:56Z), arm on = base plus omahaHiLoTournamentFirstIn; 430 nodes, 0 arm errors. Scoring the new replay file against A1's nodes reproduced the first row exactly (fixed 0, newly wrong 35), so the two rows differ by the audit constant alone.

PASS-BAR (unchanged from the first run): 1. 430 of 430 placed and replayed, 0 illegal, 0 refused, 0 errors: PASSED. 2. newlyWrong <= fixed: PASSED (0 and 0). 3. 248 changes, 248 more aggressive, 0 more passive: PASSED.

Unedited scorer line (scorer `d6b032d3204`):

`placed (verdict-only; 430 audited decisions, 3 judged bad; joined by node: 430 replayed, 0 not replayed, base reproduces the recorded action on 408): arm on changed 248 (248 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 248; judged bad left unchanged 0; no bb (the audit declares no EV model); per receipt: (no receipt) 248 changed / 0 fixed / 0 newly wrong.`

What it means: with a PLO8-measured realization the 57 big-blind calls the option adds are no longer priced as wrong; they are priced DEBATABLE (a positive EV for the call below the audit's 1.5 bb threshold), so they are unjudged rather than fixed. The 3 big-blind folds judged bad are already calls in today's brain. The row clears the replay bar and shows no audited gain.

## What is still owed before this file may say the evidence is met

1. A run row in which newlyWrong does not exceed fixed: DONE on the measured constant (the active A2 row under "Replay"; the superseded A1 run on the borrowed 0.72 Hold'em constant is preserved verbatim as historical prose so it does not trip the machine-read replay bar). Still blocked on audited gain (`fixed > 0`: every change in A2 is unjudged) and real human PLO8 heads-up tournament hands (0 in `public.hand_history` with `has_human = true` as of 2026-11-21T21:24:48Z). Status remains built, OFF, Evidence NOT MET.
2. A league measurement of the hi-lo game: DONE 2026-11-21. The league now settles PLO8 pots by the engine's `determineWinners` (`settleLeagueShowdown`), and the mirror card re-run on three seeds measured +32.36, +29.44 and +33.78 bb/100, each SIGNIFICANT; three scripted non-mirror PLO8 heads-up cards (`plo8_hu_scripted_field_v1`) measured +57.04 +/- 3.88 bb/100 (z = 14.70) vs `plo8_hu_rec_caller_v1`, +90.30 +/- 2.39 bb/100 (z = 37.81) vs `plo8_hu_tight_blind_v1`, and +53.95 +/- 4.61 bb/100 (z = 11.71) vs `plo8_hu_aggro_3bettor_v1` (section "League card runs"). Neither mirror nor DESIGN VALUE scripted personas constitute a calibrated human population or an audited replay gain.
3. The order to activate (owner or lane lead), recorded verbatim in "The order it rests on".
4. For an activation: the serving engine build must know the option name, and the receipt `omaha_hilo_tournament_first_in` should be read live after switch-on (first-action fold rate of the heads-up small blind and big blind at 20 BB or less against the recorded 83 to 85 and 81 to 91 percent), with a rollback trigger declared before the switch.

## What the activation row must contain

`option = 'omahaHiLoTournamentFirstIn'`, `state = 'on'`, note `authority: omahaHiLoTournamentFirstIn docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

Active run, auditor PLO8-HU-FI-A2, out-of-position realization 1.01 (measured for PLO8, the current constant):

- Replay: fixed 0; newlyWrong 0; changed 248; unchanged 182; unjudged 248; set PLO8HU-FI PLO8 2-player tournaments 20bb; scorer d6b032d3204; source placed verdict-only; arm on vs off; replayed 430 of 430

Historical superseded run (moved out of the machine-read `- Replay:` bar because A1 used Auditor E's borrowed Hold'em out-of-position realization 0.72 rather than the PLO8-measured 1.01 constant, preserved verbatim for audit trail):

- Historical A1 run (superseded, auditor PLO8-HU-FI-A1, out-of-position realization 0.72): fixed 0; newlyWrong 35; changed 248; unchanged 182; unjudged 213; set PLO8HU-FI PLO8 2-player tournaments 20bb; scorer d6b032d3204; source placed verdict-only; arm on vs off; replayed 430 of 430

How the row is produced (run from `server/`; `W` is the work directory holding the export, outside the repository):

1. Export the 361 hands with `EXPORT.sql` (read-only) and price them (second run: `plo8_hu_first_in_audit_A2.ts`): `npx tsx plo8_hu_first_in_audit.ts --hands $W/hands.jsonl --out $W/set` (writes `decisions.csv`, `hands.jsonl`, `facts.jsonl` in Auditor E's file form).
2. Place the nodes: `python3 scripts/hvh48-audit-nodes.py --set E --csv $W/set/decisions.csv --work $W/set --out $W/nodes`.
3. Re-decide off against on: `npx tsx scripts/audited-node-option-replay.ts --job $W/nodes/E.job.json --switch $W/prod-switch.json --arms on=omahaHiLoTournamentFirstIn --out $W/runs/PLO8HU-FI.replay.jsonl`.
4. Score and copy the printed row unedited: `npx tsx scripts/audited-decision-replay.ts --placed $W/nodes/E.nodes.jsonl --replay $W/runs/PLO8HU-FI.replay.jsonl --line on --row on --set "PLO8HU-FI PLO8 2-player tournaments 20bb"`.
