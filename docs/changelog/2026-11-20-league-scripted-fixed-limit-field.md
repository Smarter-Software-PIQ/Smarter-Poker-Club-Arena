# The league seats a scripted fixed-limit field

Antigravity Coordinator lane, 2026-11-20. Follows #11537 (the league deals legal fixed-limit hold'em) and builds what `docs/horse-league-fixed-limit.md` sections 1 and 2 designed.

## What changed

- `server/src/benchmark/FixedLimitScriptedField.ts` (new): the scripts `flh_maniac_v1` (bets or raises whenever a wager is legal, otherwise calls, never folds) and `flh_tight_value_v1` (tight raise-or-fold preflop taken from `ExploiterLeague.regPreflop`; value-only postflop by made class, a labelled design value), plus the no-limit probe script used only to seed memory.
- `HorseLeagueHumanField.ts`: the population `flh_scripted_field_v1` (variants flh, plus nlh for the probe history only) and its two personas, carried by the existing `LeagueMatchup.humanPersona`.
- `HorseLeague.ts`:
  - `seatPolicyDecision` offers a fixed-limit seat the controller's menu (`leagueActionState`).
  - `runHumanFieldMatchup` seats the scripts through `seatPolicyOf` and tallies their answers per node into `humanResponses`.
  - `playHand` refuses a fixed-limit field seat that has no script.
  - New `LeagueMatchup.probeHistoryHands` (`leagueProbeHistoryWarmup`).
  - Six cards in `FIXED_LIMIT_SCRIPTED_FIELD_CARDS`.
  - Updated refusal reasons for `flh_call_is_not_a_commitment`, `flh_river_one_bet_value_raise`, `flh_river_strong_hand_leads` and `flh_read_ignores_probes` (all four stay refused as Horse-mirror arms).
- `LeagueDecisionState.leagueFixedLimitRefusal` admits the scripted field (and no other) in a fixed-limit hand.
- `HorseLeagueComputeWorkerClient`: the worker boundary accepts a result against the scripted field.
- Defect fixed: `playHand`'s settlement now passes the hand's betting structure to `HorseMind.observe`, as production's accepted-hand learner does. Before, league memory tallied every completed fixed-limit bet as a probe.

## Results

Seeds 20261120 and 20261121, run with `npx tsx src/scripts/horseLeagueCard.ts`. bb/100 is arm A (option on) minus arm B (off), in big blinds; a fixed-limit big blind is the small bet. The first two cards ran on the working tree that became commit 95a9430a0, with the memory fix already applied; the other four ran at 95a9430a0.

| Card | Pairs per seed | Seed 20261120 | Seed 20261121 | Seeds together |
| --- | --- | --- | --- | --- |
| `flh_call_is_not_a_commitment_vs_maniac` (6 seats) | 12,000 | -28.02 +/- 7.30, 928 diverged | -21.35 +/- 8.10, 952 diverged | -24.68 +/- 5.45, z -4.53, SIGNIFICANT |
| `flh_call_is_not_a_commitment_vs_tight_value` (6 seats, harm control) | 50,000 | +0.02 +/- 0.01, 4 diverged | -0.02 +/- 0.03, 2 diverged | +0.00 +/- 0.02, not resolved |
| `flh_river_one_bet_value_raise_vs_maniac` (heads-up) | 15,000 | +1.13 +/- 0.25, 91 diverged | +1.67 +/- 0.28, 109 diverged | +1.40 +/- 0.19, z 7.38, SIGNIFICANT |
| `flh_river_one_bet_value_raise_vs_tight_value` (heads-up, harm control) | 45,000 | +0.04 +/- 0.05, 61 diverged | +0.10 +/- 0.05, 57 diverged | +0.07 +/- 0.04, not resolved |
| `flh_read_ignores_probes_vs_maniac` (6 seats, 300 no-limit hands first) | 10,000 | +226.30 +/- 24.58, 3,283 diverged | +231.46 +/- 24.76, 3,305 diverged | +228.88 +/- 17.44, z 13.12, SIGNIFICANT |
| `flh_read_ignores_probes_vs_tight_value` (6 seats, harm control) | 45,000 | -0.00 +/- 0.00, 1 diverged | 0.00 +/- 0.00, 0 diverged (INERT) | not resolved |

Every run had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks. Corrected actions came only from the hero Horse (2,091 to 2,503 per maniac run, 0 in every tight-value run); a script's answer is never corrected (pinned in the test). The solver stores were empty: the nightly worker hydrates them and these runs did not.

How to read these figures:

- `fixedLimitCallIsNotACommitment` LOSES against this field: -24.68 +/- 5.45 bb/100 across the two seeds, against the lane's +9.34 +/- 4.10 big bets per 100 hands for flh six seats against its maniac (`docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md`). The fields are not the same. Here five maniacs cap almost every street, and the Horse's memory now reads them whole (the memory fix above). Before that fix the same card read +124.10 +/- 9.45 at the same seeds and sizes (+131.90 +/- 13.67 and +116.31 +/- 13.05). That number came from the defect and is withdrawn.
- `fixedLimitReadIgnoresProbes` changes about a third of the pairs against a maniac carrying a no-limit probe history. That is the case it was built for, and the lane measured it at 23.5 to 23.8 % of deals. Against the value-only player it changes almost nothing.
- These are measurements against scripted opponents with one favourable range and one value-only range. They are not a verdict on any option. None of them meets the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`, which needs at least three ranges and a per-node table.


## Not done

- No over-folding blinds script (`fixedLimitStealVsTightBlinds`) and no passive river caller (`fixedLimitRiverStrongHandLeads` diverged in 0 of 3,000 pairs against both scripts).
- No per-node value table and no third opponent range, both of which `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` asks for.
- No option was switched on and no database was touched. Every option stays default OFF.
