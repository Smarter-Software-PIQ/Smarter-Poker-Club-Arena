# fixedLimitHiLoLowHalfFloor: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). It acts on fixed-limit Omaha hi-lo only. Legal fixed-limit betting and hi-lo settlement are now wired in the league (`flo8`), and the option has been measured on the scripted `flo8` field (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21), where divergence is rare (`3/4,000` pairs against tight-value, `+0.23 +/- 0.32 bb/100`, `z = +0.73`, not resolved) and no audited decision replay exists.

## What it does

On a fixed-limit hi-lo river the V40 weak-high pressure cap never goes below half of the sampled low share, heads-up and multiway (`HorseHiLoLowHalf.ts`; Fixed-Limit adaptation fix F3).

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_hilo_low_half_kept_seen`. Law `server/src/engine/AFixedLimitHiLoLowHalfIsKept.law.test.ts`. League cards: `flo8_hilo_low_half_floor_vs_high_barreler`, `flo8_hilo_low_half_floor_vs_maniac`, and `flo8_hilo_low_half_floor_vs_tight_value` in `FLO8_SCRIPTED_FIELD_CARDS` (`server/src/benchmark/HorseLeague.ts`, `Flo8ScriptedField.ts`, `HorseLeagueFlo8Field.test.ts`).

## League measurements (2026-11-21, legal fixed-limit flo8)

Run single-threaded via `server/src/scripts/horseLeagueCard.ts` at revision `262df0c6b8853619eb8b2196dc9aa8ffe378bd9e` (`EQUITY_GOVERNOR=off`, empty solver stores, live cash Hybrid persona, deal-seeded mood clock, `2,000` pairs per seed on fresh seeds `20261120` and `20261121` = `4,000` pairs / `8,000` hands per card; `0` illegal, `0` truncated, `0` brain fallbacks on every run):

| Card (6 seats, flo8 cash)                   | Seed 20261120 (bb/100, div) | Seed 20261121 (bb/100, div) | Pooled 4,000 pairs (bb/100) | z       | Verdict      |
| ------------------------------------------- | --------------------------- | --------------------------- | --------------------------- | ------- | ------------ |
| `flo8_hilo_low_half_floor_vs_high_barreler` | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00` | inert        |
| `flo8_hilo_low_half_floor_vs_maniac`        | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00` | inert        |
| `flo8_hilo_low_half_floor_vs_tight_value`   | `+0.19 +/- 0.57` (2)        | `+0.27 +/- 0.27` (1)        | `+0.23 +/- 0.32` (3)        | `+0.73` | not resolved |

Sizing probe (`seed 20261115`, `500` pairs): `vs_high_barreler` `0/500`, `vs_tight_value` `1/500` (`-0.80 +/- 0.80`). Per-node breakdown (`leagueChangedNodeTable.ts`, `vs_tight_value`, `seed 20261121`, `2,000` pairs): `river/facing_2 call vs fold` (`n = 1`, `+5.50 bb`, `+0.27 bb/100`), matching the F3 river-raise mechanism. In the looser multiway `high_barreler` and `maniac` fields, large multiway pots reduce fixed-limit river pot odds below `cap40` so arm B already calls; only smaller tight-value pots place `cap40` below river pot odds.

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

- Mechanism: MET by the law's fixtures.
- League: MEASURED on legal fixed-limit `flo8` (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21): `3/4,000` pairs diverged against `flo8_tight_value_v1` (`+0.23 +/- 0.32 bb/100`, `z = +0.73`, not resolved, zero harm) and `0/4,000` against `flo8_high_barreler_v1` and `flo8_maniac_v1`; `0/300` in the Horse mirror.
- Value, continuation, reach against people: NOT MEASURED in this repository. The ledger records the lane's diagnosis before the fix (flo8 six seats: river hands with a low half of 0.46 and 0.59 capped to 0.10 and 0.13 and folded 66 of 83); its archive is outside this repository.
- Historical human FLO8 micro-replay check (2026-11-21, 336 replayable `horse_policy` nodes from the 43/107 showdown hands of the 2026-11-03 02:40 to 03:53 UTC 1-person session, 0 arm errors, 0 placed audit verdicts): `fixed_limit_hilo_low_half_kept_seen` fired 6 times with **0 / 336** decisions changed.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. Hi-lo settlement and legal fixed-limit `flo8` betting in the league: DONE 2026-11-21 (`settleLeagueShowdown`, `LeagueDecisionState.ts`, `Flo8ScriptedField.ts`). Resolved value across fields is still NOT MET (`+0.23 +/- 0.32`, `z = +0.73` on `vs_tight_value`, inert on wide/maniac multiway pots).
2. The Value row: significant resolved evidence across three opponent ranges (one value-only) with per-node tables.
3. An audited fixed-limit Omaha hi-lo decision set against people. None is named in this repository, so no Replay row can be written. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitHiLoLowHalfFloor'`, `state = 'on'`, note `authority: fixedLimitHiLoLowHalfFloor docs/horse-option-authority.d/fixedLimitHiLoLowHalfFloor.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit Omaha hi-lo decision set is named in the repository)

## Rollback

If enabled, run `horse-option-switch.mjs set fixedLimitHiLoLowHalfFloor off --rollback` (`fn_ca_horse_option_switch_set('fixedLimitHiLoLowHalfFloor', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
