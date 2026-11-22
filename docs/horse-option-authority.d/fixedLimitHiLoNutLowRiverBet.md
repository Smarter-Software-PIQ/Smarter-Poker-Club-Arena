# fixedLimitHiLoNutLowRiverBet: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). It acts on fixed-limit Omaha hi-lo only. Legal fixed-limit betting and hi-lo settlement are now wired in the league (`flo8`), and the option has been measured on the scripted `flo8` field (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21): positive lean against river-folding and tight-value opponents (`+0.12 +/- 0.10`, `z = +1.21` and `+0.27 +/- 0.49`, `z = +0.56`, not resolved), `0` divergence against the calling-station field (refusal intact), and no audited decision replay exists.

## What it does

Fixed-limit hi-lo cash, heads-up, river unbet or checked to the Horse: the nut low with no high bets every time instead of 55 percent, except into a station with the bare nut low (`HorseDataLedger.ts`, SPEC-FL-02). The ledger records it as fixtures and a mechanism only, so production never sets it.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `hilo_nut_low_freeroll_bet`. Law `server/src/engine/AFixedLimitNutLowBetsTheRiverHeadsUp.law.test.ts`. League cards: `flo8_nut_low_river_bet_vs_river_folder`, `flo8_nut_low_river_bet_vs_passive_caller`, and `flo8_nut_low_river_bet_vs_tight_value` in `FLO8_SCRIPTED_FIELD_CARDS` (`server/src/benchmark/HorseLeague.ts`, `Flo8ScriptedField.ts`, `HorseLeagueFlo8Field.test.ts`).

## League measurements (2026-11-21, legal fixed-limit flo8)

Run single-threaded via `server/src/scripts/horseLeagueCard.ts` at revision `262df0c6b8853619eb8b2196dc9aa8ffe378bd9e` (`EQUITY_GOVERNOR=off`, empty solver stores, live cash Hybrid persona, deal-seeded mood clock, `2,000` pairs per seed on fresh seeds `20261120` and `20261121` = `4,000` pairs / `8,000` hands per card; `0` illegal, `0` truncated, `0` brain fallbacks on every run):

| Card (2 seats, flo8 cash)                  | Seed 20261120 (bb/100, div) | Seed 20261121 (bb/100, div) | Pooled 4,000 pairs (bb/100) | z       | Verdict      |
| ------------------------------------------ | --------------------------- | --------------------------- | --------------------------- | ------- | ------------ |
| `flo8_nut_low_river_bet_vs_river_folder`   | `+0.00 +/- 0.00` (0)        | `+0.25 +/- 0.21` (2)        | `+0.12 +/- 0.10` (2)        | `+1.21` | not resolved |
| `flo8_nut_low_river_bet_vs_passive_caller` | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00 +/- 0.00` (0)        | `+0.00` | inert        |
| `flo8_nut_low_river_bet_vs_tight_value`    | `+0.00 +/- 0.00` (0)        | `+0.55 +/- 0.98` (53)       | `+0.27 +/- 0.49` (53)       | `+0.56` | not resolved |

Sizing probe (`seed 20261115`, `500` pairs): `vs_river_folder` `0/500`, `vs_passive_caller` `0/500`. Per-node breakdown (`leagueChangedNodeTable.ts`, `seed 20261121`, `2,000` pairs):

- `vs_river_folder`: `river/checked_to bet vs check` (`n = 2`, `+2.00 bb/pair`, `+0.20 bb/100`) plus 1 downstream `flop/checked_to` memory shift (`+0.05 bb/100`).
- `vs_passive_caller`: `0/4,000` diverged (station refusal for bare nut low holds; zero harm).
- `vs_tight_value`: `river/checked_to bet vs check` (`n = 5`, `+0.40 bb/pair`, `+0.10 bb/100`) plus downstream sandbox opponent-memory shifts (`53` diverged pairs total, `+0.55 +/- 0.98`, noise-dominated).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

- Mechanism: MET by the law's fixtures.
- League: MEASURED on legal fixed-limit `flo8` (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21): `+0.12 +/- 0.10` (`z = +1.21`, `2/4,000` diverged) vs `flo8_river_folder_v1`, `+0.27 +/- 0.49` (`z = +0.56`, `53/4,000` diverged) vs `flo8_tight_value_v1`, `0/4,000` vs `flo8_passive_caller_v1` (station refusal), all not resolved / zero harm; `0/300` in the Horse mirror.
- Value, continuation, reach against people: NOT MEASURED in this repository.
- Historical human FLO8 micro-replay check (2026-11-21, read-only against the 107 retained `has_human` flo8 hands from 2026-11-03 02:40 to 03:53 UTC, 1 person and 5 Horses, `audited-node-option-replay.ts` with 76,098 `has_human` history hands as of decision and `prod-switch-20261121T1500Z.json`, zero hole cards stored): only 43 of 107 hands carry `hole_cards` (showdown hands), yielding 336 replayable `horse_policy` nodes (81 river; 0 arm errors; base fidelity 276/336 = 82.1%). On those 336 nodes, `fixedLimitHiLoNutLowRiverBet` fired `hilo_nut_low_freeroll_bet` twice and changed **1 / 336** decisions (1 river, `check->bet: 1`). Zero placed audit verdicts exist for these hands, and 1 changed decision from a single person's 73-minute session is not a replay gate.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. Hi-lo settlement and legal fixed-limit `flo8` betting in the league: DONE 2026-11-21 (`settleLeagueShowdown`, `LeagueDecisionState.ts`, `Flo8ScriptedField.ts`). Resolved value across fields is still NOT MET (larger pair count needed for rare HU nut-low freeroll spots).
2. The Value row: significant resolved evidence across three opponent ranges (one value-only) with per-node tables.
3. An audited fixed-limit Omaha hi-lo decision set against people. None is named in this repository, so no Replay row can be written. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitHiLoNutLowRiverBet'`, `state = 'on'`, note `authority: fixedLimitHiLoNutLowRiverBet docs/horse-option-authority.d/fixedLimitHiLoNutLowRiverBet.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit Omaha hi-lo decision set is named in the repository)
