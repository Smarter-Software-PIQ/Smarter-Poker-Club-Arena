# Scripted <=20bb NLH open-jammer field for nashCallVsJam (2026-11-21)

`nashCallVsJam` (default ON in source since 2026-11-07, `docs/changelog/2026-11-07-nash-push-fold-v2.md`) passed its mirror league cards (`+0.80` to `+4.86 bb/100` across 10-15bb cash and MTT) but had 0 divergent pairs against the human-calibrated population because that population sizes every raise and never open-jams. This change adds a scripted `<=20bb` NLH open-jammer population and a tight/nut-only harm control to `nlh_scripted_field_v1`, registers four six-max league cards, and records a declared 3-seed evaluation.

## What changed

- `server/src/benchmark/HorseLeagueHumanField.ts`: registered two new `nlh_scripted_field_v1` personas (`NLH_NASH_OPEN_JAMMER_PERSONA = 'nlh_nash_open_jammer_v1'` and `NLH_TIGHT_JAMMER_PERSONA = 'nlh_tight_jammer_v1'`).
- `server/src/benchmark/NlhScriptedField.ts`: implemented both scripted seat policies as pure functions of their own hole cards and public `LeagueSeatSpot` state (no randomness, no Horse brain calls):
  - `nlhNashOpenJammerPolicy` (`nlh_nash_open_jammer_v1`): unopened at `<=20bb`, open-jams when `HorseNashPushFoldV2.nashV2JamUpTo(hand, behind, deadAnteBB, 1) >= depthBB` across UTG/HJ/CO/BTN/SB in both cash (0 ante) and BBA MTT (1bb ante), and folds below; facing a lone open-jam at `<=20bb`, calls when `nashV2CallUpTo(...) >= effBB` (deterministic `>=` cutoff labelled DESIGN VALUE; non-jam preflop and rare postflop thresholds labelled DESIGN VALUE).
  - `nlhTightJammerPolicy` (`nlh_tight_jammer_v1`, harm control): open-jams and continues only with the top ~9% of hands (`humanCalibratedPreflopPercentile >= 0.91`, DESIGN VALUE) at `<=20bb`, folding everything else; value-only postflop (DESIGN VALUE).
- `server/src/benchmark/HorseLeague.ts`: registered `NLH_SCRIPTED_OPEN_JAMMER_CARDS` (4 six-max cards, `pairs: 6000`, `hybridBaseline: true`, `moodClock: 'deal_seed'`, arm A = `{}` default on, arm B = `{ nashCallVsJam: false }`):
  - `nlh_scripted_nash_open_jammer_cash_12bb` (cash 12bb, no ante)
  - `nlh_scripted_nash_open_jammer_12bb` (MTT 12bb, 1bb BBA)
  - `nlh_scripted_nash_open_jammer_15bb` (MTT 15bb, 1bb BBA)
  - `nlh_scripted_tight_jammer_15bb` (MTT 15bb, 1bb BBA, tight-jammer harm control)
- `server/src/benchmark/NlhScriptedField.test.ts`: added unit tests for `preflopSeatsBehind`, both jammer policies, legality/determinism/chip-conservation checks across all `NLH_SCRIPTED_PERSONAS`, and end-to-end card tests verifying scripted open-jams (`all_in`), `nash_call_vs_jam` telemetry fires, non-inert divergence, `0/0/0/0` harness counts, and worker validation.
- `docs/horse-option-authority.d/nashCallVsJam.md`: recorded the scripted open-jammer field results under a new `## Scripted open-jammer field (2026-11-21)` section without modifying existing `## Replay` rows.

No strategy threshold, migration, or live switch row was modified.

## Declared 3-seed evaluation

Runner: `cd server && EQUITY_GOVERNOR=off nice -n 19 npx tsx src/scripts/horseLeagueCard.ts --card=<name> --seed=20261120,20261121,20261122 --pairs=6000` (`6,000` pairs per seed x 3 seeds = `18,000` pairs / `36,000` hands per card). Engine revision: `3cf91d8a41712e5b56137ab7194ee2f65b49ea92`. Solver stores empty (`charts=0 postflop=0 postflopV31=0`). Every run recorded `illegal=0`, `truncated=0`, `corrected=0`, `brainFallbacks=0`.

| card                                      | seed 20261120                         | seed 20261121                          | seed 20261122                         | pooled (A - B, 18,000 pairs)                   | total divergent |
| ----------------------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------------- | ---------------------------------------------- | --------------- |
| `nlh_scripted_nash_open_jammer_cash_12bb` | `+0.45 +/- 1.83` (`z +0.25`, 77 div)  | `+0.53 +/- 2.18` (`z +0.24`, 111 div)  | `+3.81 +/- 2.26` (`z +1.69`, 117 div) | `+1.60 +/- 1.21` (`z +1.32`), not resolved     | 305             |
| `nlh_scripted_nash_open_jammer_12bb`      | `+4.86 +/- 3.87` (`z +1.25`, 344 div) | `+7.91 +/- 3.91` (`z +2.02`, 333 div)  | `+6.52 +/- 3.93` (`z +1.66`, 341 div) | `+6.43 +/- 2.25` (`z +2.85`), SIGNIFICANT      | 1,018           |
| `nlh_scripted_nash_open_jammer_15bb`      | `+4.36 +/- 4.16` (`z +1.05`, 258 div) | `+10.28 +/- 4.22` (`z +2.44`, 257 div) | `+2.25 +/- 4.05` (`z +0.56`, 251 div) | `+5.63 +/- 2.39` (`z +2.35`), SIGNIFICANT      | 766             |
| `nlh_scripted_tight_jammer_15bb`          | `-7.38 +/- 2.51` (`z -2.94`, 101 div) | `-5.67 +/- 2.61` (`z -2.18`, 108 div)  | `-6.23 +/- 2.70` (`z -2.31`, 118 div) | `-6.43 +/- 1.50` (`z -4.27`), SIGNIFICANT harm | 327             |

### Per-arm absolute win rates against each field (bb/100, mean across 3 seeds)

- `nlh_scripted_nash_open_jammer_cash_12bb`: arm A `+2.18` (`+8.61`, `-2.81`, `+0.73`), arm B `+0.58` (`+8.16`, `-3.35`, `-3.09`).
- `nlh_scripted_nash_open_jammer_12bb`: arm A `+7.69` (`+15.51`, `+4.23`, `+3.33`), arm B `+1.26` (`+10.65`, `-3.68`, `-3.19`).
- `nlh_scripted_nash_open_jammer_15bb`: arm A `+6.82` (`+13.08`, `+8.48`, `-1.10`), arm B `+1.19` (`+8.72`, `-1.80`, `-3.35`).
- `nlh_scripted_tight_jammer_15bb`: arm A `+19.82` (`+23.84`, `+17.91`, `+17.71`), arm B `+26.25` (`+31.22`, `+23.58`, `+23.95`).

## Findings

1. Against realistic short-stack Nash open-jammers (a non-mirror field that actually open-jams `<=20bb` across UTG/HJ/CO/BTN/SB), `nashCallVsJam` earns significantly in MTT 12bb (`+6.43 +/- 2.25 bb/100`, `z +2.85`, 1,018 divergent pairs) and MTT 15bb (`+5.63 +/- 2.39 bb/100`, `z +2.35`, 766 divergent pairs), and is positive on all 3 seeds in cash 12bb (`+1.60 +/- 1.21 bb/100`, `z +1.32`, 305 divergent pairs).
2. Against the tight/nut-only harm control (five seats shoving only the top ~9% from every position at 15bb MTT BBA), hero still wins `+19.82 bb/100` with `nashCallVsJam` on (because the nit folds 91% of blinds), but gives back `-6.43 +/- 1.50 bb/100` (`z -4.27`, 327 divergent pairs) relative to arm B (`nashCallVsJam: false`) because the chip-EV Nash caller table assumes equilibrium push widths (~38-65% from BTN/SB) and does not tighten when facing a read tight/nit jammer. Future follow-up work could condition `nashCallVsJam` on a proven tight-raiser read without weakening its equilibrium performance against realistic shovers.
