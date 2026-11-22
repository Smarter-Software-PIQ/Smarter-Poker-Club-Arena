# fixedLimitOmahaNoPresumption: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). It acts on fixed-limit Omaha hi-lo only. Legal fixed-limit betting and hi-lo settlement are now wired in the league (`flo8`), and the option has been measured across all three scripted `flo8` fields (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21) with no resolved gain (`-2.98 +/- 1.94`, `+0.19 +/- 4.95`, `+1.42 +/- 4.64 bb/100`), is shadowed in production whenever `omahaNeutralUnknown` is ON (`HorseMind.ts:2808-2832`), and has no audited decision replay.

## What it does

On a fixed-limit Omaha decision (flo8) `HorseMind.opponentRead` does not apply the shared aggressive raise presumption, a pot-limit policy that prices a pot-sized raise; the opponent's own measured read stands. Pot-limit Omaha is unchanged (Tight fix T1).

**Production interaction note (`HorseMind.ts:2808-2832`):** `if (family === 'omaha' && this.decisionReadOptions.omahaNeutralUnknown === true)` returns early before `fixedLimitOmahaNoPresumption` is checked, with no betting-structure exclusion. On the live production switch set where `omahaNeutralUnknown` is ON, `fixedLimitOmahaNoPresumption` is shadowed and changes no decision.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_omaha_presumption_withheld`. Law `server/src/engine/AFixedLimitOmahaHasNoPresumption.law.test.ts`. League cards: `flo8_no_omaha_presumption` (2-seat Horse mirror in `FIXED_LIMIT_OMAHA_HILO_CARDS`) plus `flo8_no_omaha_presumption_vs_tight_value`, `flo8_no_omaha_presumption_vs_high_barreler`, and `flo8_no_omaha_presumption_vs_maniac` (6-seat scripted fields in `FLO8_SCRIPTED_FIELD_CARDS`, `Flo8ScriptedField.ts`, `HorseLeagueFlo8Field.test.ts`).

## League measurements (2026-11-21, legal fixed-limit flo8)

Mirror probe (`flo8_no_omaha_presumption`, 2 seats, `seed 20261115`, `300` pairs, bare `b = {}`): `+11.42 +/- 4.07 bb/100` (`59/300` diverged).

Scripted 6-max cards run single-threaded via `server/src/scripts/horseLeagueCard.ts` at revision `262df0c6b8853619eb8b2196dc9aa8ffe378bd9e` (`EQUITY_GOVERNOR=off`, empty solver stores, live cash Hybrid persona, deal-seeded mood clock, bare `b = {}`, `2,000` pairs per seed on fresh seeds `20261120` and `20261121` = `4,000` pairs / `8,000` hands per card; `0` illegal, `0` truncated, `0` brain fallbacks on every run):

| Card (6 seats, flo8 cash)                    | Seed 20261120 (bb/100, div) | Seed 20261121 (bb/100, div) | Pooled 4,000 pairs (bb/100) | z       | Verdict      |
| -------------------------------------------- | --------------------------- | --------------------------- | --------------------------- | ------- | ------------ |
| `flo8_no_omaha_presumption_vs_tight_value`   | `-1.68 +/- 2.38` (81)       | `-4.29 +/- 3.08` (81)       | `-2.98 +/- 1.94` (162)      | `-1.53` | not resolved |
| `flo8_no_omaha_presumption_vs_high_barreler` | `+1.61 +/- 7.30` (206)      | `-1.23 +/- 6.68` (204)      | `+0.19 +/- 4.95` (410)      | `+0.04` | not resolved |
| `flo8_no_omaha_presumption_vs_maniac`        | `+7.50 +/- 6.84` (7)        | `-4.65 +/- 6.28` (7)        | `+1.42 +/- 4.64` (14)       | `+0.31` | not resolved |

Sizing probe (`seed 20261115`, `500` pairs): `vs_tight_value` `+4.43 +/- 4.76` (`24/500`), `vs_maniac` `+39.60 +/- 21.39` (`35/500`). Per-node breakdown (`leagueChangedNodeTable.ts`, `seed 20261121`, `2,000` pairs):

- `vs_tight_value`: primary negative driver is `preflop/facing_1 fold vs call` (`n = 26`, `-2.82 bb/pair`, `-3.66 bb/100`), partially offset by `preflop/facing_0 raise vs fold` (`n = 12`, `+2.25 bb/pair`, `+1.35 bb/100`).
- `vs_high_barreler`: `preflop/facing_1 fold vs call` (`n = 105`, `-0.41 bb/100`), `preflop/facing_1 call vs raise` (`n = 37`, `-1.34 bb/100`), `preflop/facing_0 fold vs raise` (`n = 7`, `+2.06 bb/100`).
- `vs_maniac`: `7` diverged pairs (`flop/facing_3 fold vs call`, `n = 2`, `-6.00 bb/100`), quickly superseded once maniac counters fill.

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

- Mechanism: MET by the law's fixtures (note: shadowed by `omahaNeutralUnknown` when ON in production).
- League: MEASURED on legal fixed-limit `flo8` (`FLO8_SCRIPTED_FIELD_CARDS`, 2026-11-21): `-2.98 +/- 1.94` (`z = -1.53`, `162/4,000`) vs `flo8_tight_value_v1`, `+0.19 +/- 4.95` (`z = +0.04`, `410/4,000`) vs `flo8_high_barreler_v1`, `+1.42 +/- 4.64` (`z = +0.31`, `14/4,000`) vs `flo8_maniac_v1` (all not resolved, bare `b = {}`); mirror probe `+11.42 +/- 4.07` (`59/300`, `seed 20261115`).
- Value, continuation, reach against people: NOT MEASURED in this repository. The ledger records the lane's diagnosis before the fix (a 21 to 27 percent flo8 raiser stayed presumed at 1,000 hands); its archive is outside this repository.
- Historical human FLO8 micro-replay check (2026-11-21, read-only against the 107 retained `has_human` flo8 hands from 2026-11-03 02:40 to 03:53 UTC, 1 person and 5 Horses, `audited-node-option-replay.ts` with 76,098 `has_human` history hands as of decision and `prod-switch-20261121T1500Z.json`, zero hole cards stored): only 43 of 107 hands carry `hole_cards` (showdown hands), yielding 336 replayable `horse_policy` nodes (74 preflop, 94 flop, 87 turn, 81 river; 0 arm errors; base fidelity 276/336 = 82.1%). On those 336 nodes, `fixedLimitOmahaNoPresumption` fired `fixed_limit_omaha_presumption_withheld` on 336/336 nodes and changed **4 / 336** decisions (2 preflop, 1 flop, 1 turn; `raise->call: 2`, `fold->raise: 1`, `call->fold: 1`). Zero placed audit verdicts exist for these hands, and 4 changed decisions from a single person's 73-minute session is not a replay gate.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. Hi-lo settlement and legal fixed-limit `flo8` betting in the league: DONE 2026-11-21 (`settleLeagueShowdown`, `LeagueDecisionState.ts`, `Flo8ScriptedField.ts`).
2. The Value row: NOT MET (scripted 6-max fields show `-2.98 +/- 1.94` vs tight-value and null vs barreler/maniac; furthermore, `omahaNeutralUnknown` already supersedes this option in production).
3. An audited fixed-limit Omaha hi-lo decision set against people. None is named in this repository, so no Replay row can be written. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitOmahaNoPresumption'`, `state = 'on'`, note `authority: fixedLimitOmahaNoPresumption docs/horse-option-authority.d/fixedLimitOmahaNoPresumption.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit Omaha hi-lo decision set is named in the repository)
