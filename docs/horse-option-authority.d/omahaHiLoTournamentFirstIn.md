# omahaHiLoTournamentFirstIn: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, tests and off-identity are recorded, and the declared offline evaluation is recorded as SUPPORTED on two seeds and the league card measured +36.54 bb/100 (stderr 4.92) on seed 20261120 against a mirror field; the replay on real audited decisions was not run, no live read exists, and no PASS-BAR for a replay is declared.

Written 2026-11-20 from what the repository records (sources named per section). Nothing was run for this file and no number in it was measured on 2026-11-20.

## What it does

Source: `docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`, `server/src/engine/HorsePreflop.ts` (`OMAHA_HILO_TOURNAMENT_FIRST_IN`), `server/src/engine/HorseDataLedger.ts` (flag `omahaHiLoTournamentFirstIn`).

Pot-limit Omaha hi-lo (PLO8) in an engine-declared tournament, exactly two dealt in, 20 big blinds or less. With the option on, HorseLogic passes the hand's hi-lo percentile (`omahaPreflopPercentile(cards, true)`) to the preflop engine and the Omaha high replacement function `omahaTournamentFirstIn` runs with `OMAHA_HILO_TOURNAMENT_FIRST_IN`:

- the small blind first in plays every hand as the pot-limit maximum raise (`headsUpShare: 1`);
- the big blind calls its top 75 percent against one raise at a price of a half or better (`bigBlindDefendShare: 0.75`, `bigBlindMaxPrice: 0.5`);
- 20 BB ceiling (`maxStackBB: 20`); every three-handed branch is zero and the table is capped at two dealt in even when a league arm asks for more (`maxTableSize: 2`).

It replaces only a fold. All-In-Or-Fold, locked satellite seats, cash, fixed-limit hi-lo, Omaha high and deeper stacks stand aside. `HorseOmahaTournamentFirstIn.ts` itself is unchanged by it.

Default OFF in source: only explicit `true`, or a league arm's parameter object, switches it on; off, nothing is computed. It is a registered option of the Horse option switch (`server/src/engine/HorseOptionSwitch.ts`: registered name, lane 'Heads Up', scope 'PLO8 tournament, heads-up, <= 20 bb'; not in `OPTION_SWITCH_OFF_ONLY`) and is named by the switch-list migrations from `supabase/migrations/20261115191000_horse_option_switch_plo_strategy_options.sql` on.

## The order it rests on

No owner order naming this option is recorded in the repository. The changelog records its origin as lane work: "Lane: Heads Up (HU-HILO-002; delegated by PLO Strategy 2026-11-14T22:47Z; HU-HILO-003, PLO8 cash and deeper than 20 BB, is not part of this change)". An activation row needs the lane lead's or the owner's order recorded here, verbatim, before it cites this file.

## What it answers

Source: the changelog, "Why" (it cites the heads-up audit `hu-audit-01UxDLnM/variants/FINDINGS.md`, which is in the audit archive, not in this repository).

At 20 big blinds or less in pot-limit Omaha hi-lo tournaments "the heads-up small blind folds 83 to 85 percent of its first actions and the big blind folds 81 to 91 percent to one raise". It is the same commitment-zone fold that #10687 corrected for Omaha high; hi-lo was left out on purpose because it needed its own evaluation.

## Receipts

`omaha_hilo_tournament_first_in` (`HorseDataLedger.ts`, source 'HorsePreflop (omahaHiLoTournamentFirstIn)'); ledger flag `omahaHiLoTournamentFirstIn`.

## Tests

`server/src/engine/HorseOmahaHiLoTournamentFirstIn.law.test.ts` (10 cases, as the changelog records them): the published limits; off, absent and every non-true scalar change no decision and fire nothing; PLO8 heads-up small blind at 8/12/20 BB folds at least 40 percent off and at most 5 percent on, every change is a fold turned into a legal action with its receipt; the big blind facing one pot raise folds at least 25 points less and still folds at least 10 percent; Omaha high (PLO4/5/6), cash, 25 BB, three-handed (including a league arm that asks for three-handed) and fixed-limit hi-lo unchanged; a league arm can switch the small blind part off. Registered in `docs/laws.d/server-src-engine-HorseOmahaHiLoTournamentFirstIn.md`.

League card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb` (`server/src/benchmark/HorseLeague.ts`: PLO8, two seats, 12 BB, final-table tournament context, 6,000 pairs, arm A the option on, arm B today's brain). Its measured runs are under "League card runs" below.

## League card runs

Run 2026-11-20 by a coordinator agent of session 01UxDLnH with the single-card league runner (PR #11534), and supplied to this file as copied below; the run's own output files are not in this repository. Opponents are the Horse brain itself (mirror field), so this is the same limit as the evaluation below: no human-calibrated field.

| seed     | card                                            | arm A                               | arm B | variant, seats, depth, format    | field  | pairs (hands) | bb/100 (A minus B) | stderr | block stderr (blocks) | verdict     | engine revision                          | wall    | illegal actions |
| -------- | ----------------------------------------------- | ----------------------------------- | ----- | -------------------------------- | ------ | ------------- | ------------------ | ------ | --------------------- | ----------- | ---------------------------------------- | ------- | --------------- |
| 20261120 | plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb | {"omahaHiLoTournamentFirstIn":true} | {}    | plo8, 2 seats, 12 bb, tournament | mirror | 6000 (12000)  | +36.54             | 4.92   | 5.41 (40)             | SIGNIFICANT | 63f3215d2f568bda6ae17682260fcfedc0e20330 | 567.5 s | 0               |

Further seeds: running on 2026-11-20; each is added as one more row of this table, copied from the runner's output unedited. A league card is not the replay on audited decisions and does not change the status of this file.

## The recorded evaluation (offline, opponents are variants of the Horse brain)

Source, quoted exactly: `docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`, "Evaluation". Declared before any result in `hu-audit-01UxDLnM/evaluation/DECLARATION-HU-HILO-002.md`; tables and raw per-group results in `hu-audit-01UxDLnM/evaluation/results-HU-HILO-002/` (both in the audit archive, not in this repository, and not re-read for this file).

Method as recorded: "PLO Strategy's Evaluation Protocol 2 method, PLO8: real HandController hands, heads-up tournament, every deal played from both seats, paired difference option minus off in big blinds per hand against five opponents (old, tight, wide, call-heavy, adaptive re-shover) at 8, 12 and 20 BB, 4,000 hands per cell."

- "Development seed 94101, option on minus off: +0.53 to +0.55 at 8 BB, +0.45 to +0.49 at 12 BB, +0.28 to +0.30 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.17 / +0.15 / +0.05 and adaptive +0.30 / +0.20 / +0.00 (no cell below zero). Declared rule: SUPPORTED. The small blind part carries the gain; the big blind part alone was not distinguishable from zero in any cell."
- "Confirmation, fresh seed 94202, run once and reported as it is: +0.57 to +0.59 at 8 BB, +0.49 to +0.55 at 12 BB, +0.34 to +0.37 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.27 / +0.27 / +0.12 and adaptive +0.38 / +0.28 / +0.11 (no cell below zero; 20 BB includes zero). Declared rule: SUPPORTED."

Limits as recorded: "Every opponent is a variant of the Horse brain; no human-calibrated Omaha field is qualified. Chips only (heads-up, so payout-linear). At 20 BB the gain against a re-shoving or call-heavy opponent is not distinguishable from zero, as for Omaha high."

## Evidence rows

- Mechanism, scope, visibility (receipt), tests: recorded (sections above).
- Option unset or false: decisions identical (the law test above).
- League card (mirror field, Horse-brain opponents): seed 20261120, +36.54 bb/100, stderr 4.92, SIGNIFICANT (section above); further seeds owed.
- Declared offline evaluation: SUPPORTED on development seed 94101 and on confirmation seed 94202 (changelog). It is an offline result against Horse-brain opponents, not a replay on audited decisions and not a live read.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Value against people, live reach of the receipt: NOT MEASURED.

## What is still owed before this file may say the evidence is met

1. A PASS-BAR for the replay, declared in this file before the replay runs (what the scorer's line must show).
2. A set of real audited PLO8 heads-up tournament decisions at 20 BB or less. None is named in the repository; whether the audit sources the scorer reads (`--audit2`, `--woowoo`) hold any such decision has not been checked. If they hold none, the set must be built and audited first.
3. The replay itself, off against on, written by the committed scorer (`npx tsx scripts/audited-decision-replay.ts ... --row <arm> --set <name>`, from server/), with the arms' option sets declared, and its run rows copied unedited under "Replay" in place of the NOT RUN row; in every run row newlyWrong must not exceed fixed.
4. The order to activate (owner or lane lead), recorded verbatim in "The order it rests on".
5. For an activation: the serving engine build must know the option name, and the receipt `omaha_hilo_tournament_first_in` should be read live after switch-on (first-action fold rate of the heads-up small blind and big blind at 20 BB or less against the recorded 83 to 85 and 81 to 91 percent), with a rollback trigger declared before the switch.

## What the activation row must contain

`option = 'omahaHiLoTournamentFirstIn'`, `state = 'on'`, note `authority: omahaHiLoTournamentFirstIn docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited PLO8 heads-up tournament decision set is named in the repository)
