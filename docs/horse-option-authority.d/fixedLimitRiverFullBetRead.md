# fixedLimitRiverFullBetRead: authority for the live switch

Failed evaluation, locked. Evidence NOT MET: the option is off-only in the registry (`OPTION_SWITCH_OFF_ONLY`, status `harm`, reason "failed evaluation: off-only from the moment the option lands in the ledger", source "programme coordinator, 2026-11-14 (failed evaluation)"). This file proposes no switch row.

## What it does

Fixed limit, river, facing a wager: the wagerer is read as having made a full bet (a raise as a raise) instead of a small no-limit bet, in the range samplers only (`HorseFixedLimitWagerRead.ts`, SPEC-FL-01). The ledger records it as fixtures and a mechanism only, so production never sets it.

## The order it rests on

None to switch it on.

## Receipts and tests

Receipt `fixed_limit_river_full_bet_read_seen`. Law `server/src/engine/AFixedLimitRiverBetIsReadAsAFullBet.law.test.ts`. League card `flh_river_full_bet_read` (`FIXED_LIMIT_HOLDEM_CARDS`, heads-up, Horse mirror; it only measures).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

Horse-mirror league readings recorded in `docs/horse-league-fixed-limit.md` (seed 20261115, 300 pairs each, heads-up, 0 illegal actions): Hybrid cash with the deal-seeded mood clock, 9 pairs diverged, +1.33 +/- 1.15 bb/100; plain, 7 diverged, +1.33 +/- 1.05. Neither is significant. The evaluation that failed it is the programme coordinator's of 2026-11-14; its figures are not recorded in this repository.

- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What would lift the lock

A new declared evaluation that passes, then the `OPTION_SWITCH_OFF_ONLY` entry removed in source and the switch lists regenerated, then every evidence row. Until then nothing is proposed.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions is recorded; the option is off-only after a failed evaluation, and no audited fixed-limit-versus-people decision set is named in the repository)
