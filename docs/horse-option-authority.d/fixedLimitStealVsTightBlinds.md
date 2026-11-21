# fixedLimitStealVsTightBlinds: authority for the live switch

Owner hold, not lifted. Evidence NOT MET: the option is off-only in the registry (`optionSwitchOffOnly`: status `hold`, source "owner hold: blind steal; owner ruling 2026-11-14 21:30 Chicago (tight steal responses stay OFF)", reason "a steal option: held until the owner lifts it by name") and it widens a preflop first-in range, which is what the owner preflop range hold covers. This file does not lift the hold and proposes no switch row.

## What it does

Fixed-limit cash tables only (inert at every tournament table). First in from the cutoff, the button or the small blind (or the heads-up button), when every player still to act has his own over-folder read (postflop fold to a bet engaged high on at least 15 decayed opportunities, not presumed, no preflop statistic engaged wide) and none is all in, the open share widens by up to 15 points, scaled by the weakest read's excess (`server/src/engine/HorseFixedLimitPreflop.ts`; Fixed-Limit lane W5).

## The order it rests on

None to switch it on. The hold above stands until the owner lifts it by name (the precedent is `OPTION_SWITCH_PREFLOP_HOLD_LIFTED`, #11538, for one heads-up option).

## Receipts and tests

Receipt `fixed_limit_steal_vs_tight_blinds`. Law `server/src/engine/AFixedLimitStealsFromOverFoldingBlinds.law.test.ts`. League card `flh_steal_vs_tight_blinds_vs_over_folding_blinds` (`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, pinned by `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (6 seats) | Pairs per seed | Seed 20261120 | Seed 20261121 | Seeds together |
| --- | --- | --- | --- | --- |
| `flh_steal_vs_tight_blinds_vs_over_folding_blinds` | 10,000 | +7.00 +/- 0.39, 388 diverged | +6.68 +/- 0.39, 353 diverged | +6.84 +/- 0.28, z 24.68, SIGNIFICANT |

Measured 2026-11-21 on the working tree of this file's pull request (base 5bfaa38d0). The block standard errors were 0.44 and 0.49. A development probe at seed 20261115 (3,000 pairs) read +6.47 +/- 0.74, 109 diverged. A Horse mirror moves nothing: 0 of 300 pairs (seed 20261115).

- Mechanism: MET by the law's fixtures.
- Value: NOT MET. This is ONE favourable range, and the most favourable one there is: `flh_over_folding_blinds_v1` never raises, folds a six-max blind to one raise 82% of the time and folds to every postflop wager (a DESIGN VALUE; no record in this repository states the lane's over-folder thresholds). No value-only range, no harm control and no per-node table exist. In particular the case the option can lose in, a player whose postflop fold read is high but who defends his blinds, is not measured.
- A finding from building the script: a first form with mixed frequencies (the tight-value raise-or-fold preflop, postflop continuing with two pair or better) never engaged the option at seed 20261115: 0 of 10,000 pairs diverged, and the one counter row printed during a separate 2,500-pair run held 12.4 decayed fold opportunities against the 15 required. The read ages an opportunity-gated statistic at its fast rate whenever a fast-window rate differs from the long one by 0.2 (`HorseOpponentExploit.styleShiftReleased`), which a mixed frequency trips by chance. How often a real over-folding player keeps 15 decayed opportunities is NOT MEASURED, so reach against people is unknown and may be small.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. The owner hold lifted by name. Evidence work does not lift it.
2. Harm controls: at least a value-only range and a blind that folds postflop but defends preflop, with the per-node table (Value row).
3. Reach: how many recorded fixed-limit first-in decisions against people would change, with the reads those opponents actually carried.
4. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited.
5. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".

## What the activation row must contain

`option = 'fixedLimitStealVsTightBlinds'`, `state = 'on'`, note `authority: fixedLimitStealVsTightBlinds docs/horse-option-authority.d/fixedLimitStealVsTightBlinds.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
