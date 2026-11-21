# fixedLimitCallIsNotACommitment: authority for the live switch

Measured harm, locked. Evidence NOT MET: the option is off-only in the registry (`OPTION_SWITCH_OFF_ONLY`, status `harm`, #11567) and the database refuses `on` for it since list migration 20261121024624. This file proposes no switch row.

## What it does

Fixed-limit hold'em cash only: a call facing a bet is never priced in the committed branch (no stack-to-pot or invested-share term); it is priced on its incremental cost plus the remaining action of the street (`server/src/engine/HorseFixedLimitCallPrice.ts`; Fixed-Limit adaptation fix F2, scoped to hold'em cash on 2026-11-16).

## The order it rests on

None to switch it on. Antigravity Coordinator ruling of 2026-11-20 (`docs/changelog/2026-11-20-fixed-limit-call-commitment-measured-harm.md`): off-only as measured harm.

## Receipts and tests

Receipts `fixed_limit_call_not_a_commitment_seen`, `fixed_limit_call_priced_remaining_action_seen`. Laws `server/src/engine/AFixedLimitCallIsNotACommitment.law.test.ts`, `AFixedLimitFixKeysOnTheBettingStructure.law.test.ts`. League cards `flh_call_is_not_a_commitment_vs_maniac` and `_vs_tight_value`.

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (6 seats)                                               | Pairs per seed | Seed 20261120                 | Seed 20261121                 | Seeds together                             |
| ------------------------------------------------------------ | -------------- | ----------------------------- | ----------------------------- | ------------------------------------------ |
| `flh_call_is_not_a_commitment_vs_maniac`                     | 12,000         | -28.02 +/- 7.30, 928 diverged | -21.35 +/- 8.10, 952 diverged | -24.68 +/- 5.45, z -4.53, SIGNIFICANT harm |
| `flh_call_is_not_a_commitment_vs_tight_value` (harm control) | 50,000         | +0.02 +/- 0.01, 4 diverged    | -0.02 +/- 0.03, 2 diverged    | +0.00 +/- 0.02, not resolved               |

Measured 2026-11-20 (PR #11565, `docs/horse-league-fixed-limit.md`), after that pull request's league memory fix. An earlier +124 bb/100 reading of the first card came from the memory defect and is withdrawn. The source-default file `docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md` records the lane's own offline figure (+9.34 +/- 4.10 big bets per 100 hands against its maniac), which this field does not reproduce.

- Value: FAILED. Significant loss against the maniac, flat against the value-only player, no positive cell.
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 1 diverged, +0.0375 +/- 0.0375 bb/100; production personas, 600 pairs: 2 diverged, +0.25 +/- 0.18. Both equal the readings taken before the fix.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Audited set against people: none possible for fixed-limit hold'em. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment.

## What would lift the lock

A new evaluation with a positive cell and no harm cell, then the `OPTION_SWITCH_OFF_ONLY` entry removed in source and the switch lists regenerated, then every row above. Until then nothing is owed and nothing is proposed.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions is recorded; the option is off-only as measured harm in the league, and no audited fixed-limit-versus-people decision set is named in the repository)
