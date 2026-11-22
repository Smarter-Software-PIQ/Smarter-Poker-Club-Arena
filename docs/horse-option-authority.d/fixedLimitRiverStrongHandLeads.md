# fixedLimitRiverStrongHandLeads: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). No league field moves it: against every scripted opponent built, the passive caller included, it changed at most 1 pair in 20,000, so it has no value measurement at all.

## What it does

Fixed limit only, river, nothing to call, the Horse first to act and the reference checks: a full house or better that at most 12 percent of the opponents' holdings beat (card-exact over the unseen cards) bets one big bet instead (`server/src/engine/HorseFixedLimitRiverLead.ts`; Fixed-Limit lane W8). An aggressive read on the next opponent keeps the check. Not facing a wager, never all in, never a tournament stack under 20 big blinds.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_river_strong_hand_lead`. Law `server/src/engine/AFixedLimitStrongRiverHandLeads.law.test.ts`. No league card: the arm is refused as unmeasurable (`UNMEASURABLE_MATCHUPS`, `flh_river_strong_hand_leads`), with the measurements below in its reason.

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Field                                       | Seats   | Seed     | Pairs      | Diverged | bb/100                       |
| ------------------------------------------- | ------- | -------- | ---------- | -------- | ---------------------------- |
| Horse mirror                                | 2 and 6 | 20261115 | 300 each   | 0        | 0                            |
| Production personas mirror                  | 6       | 20261120 | 300        | 1        | +0.11 +/- 0.11               |
| `flh_maniac_v1`                             | 6 and 2 | 20261115 | 3,000 each | 0        | 0                            |
| `flh_tight_value_v1`                        | 6       | 20261115 | 3,000      | 0        | 0                            |
| `flh_passive_caller_v1`                     | 2       | 20261120 | 20,000     | 1        | -0.01 +/- 0.01, not resolved |
| `flh_passive_caller_v1`                     | 2       | 20261121 | 20,000     | 0        | INERT                        |
| `flh_passive_caller_v1` (development probe) | 2       | 20261115 | 10,000     | 2        | 0.00 +/- 0.03                |
| `flh_passive_caller_v1` (development probe) | 6       | 20261115 | 4,000      | 0        | INERT                        |

The passive-caller rows were measured on 2026-11-21 with a card `flh_river_strong_hand_leads_vs_passive_caller` (heads-up, arm A the option on) that was on the league card only for the measurement and is not kept: one changed pair in 20,000 reads inert on a nightly run. The two development probes sized the run and are reported for completeness. The earlier rows are from `docs/horse-league-fixed-limit.md`.

- Mechanism: MET by the law's fixtures.
- Value: NOT MEASURED. Root-cause reach diagnosis (verified 2026-11-21 against `origin/main` `server/src/engine/HorseLogic.ts`): the option is NOT dead code, but the ONLY code path where the FLH reference checks a full house+ first to act on the river is the V11 Initiative Gate (`HorseLogic.ts:26232`, `initiative === 'opp' && !prevChecked && !ip && !priorAggressorCheckedThisStreet`), because the monster slowplay branch at `HorseLogic.ts:26330` is guarded by `!isRiver` (so Hero with initiative or after a checked-through turn already bets 100% of full houses+ on the river; `holdemRiverFullHouseValue` at line 26183 excludes fixed limit). Every existing FLH scripted field structurally misses this narrow intersection:
  - `flh_maniac_v1` (0/6,000): holds turn initiative so V11 checks, but `fixedLimitRiverStrongHandLeads` explicitly stands down (`verdict === 'aggressive_next'`) because `isAggressor(read) || isPostflopManiac(read)` is true (`HorseLogic.ts:7242`).
  - `flh_passive_caller_v1` (1/40,000) and `flh_tight_value_v1` (0/3,000): only bet flop/turn with two pair or better (`betClass`/`valueClass = 3`), so `initiative === 'opp'` on the turn while Hero OOP holds a non-underfull top full house+ (`beatenAny <= 0.12`) requires a cooler-on-cooler intersection (~1/20,000).
  - Horse mirror (7/2,000 = 0.35%) vs lane census `AD-STRONG-RIVER-CHECKS.md` (35.1% = 123/350 FLH HU, 35.7% = 131/367 FLO8 HU): 35.1% is conditional on already reaching the river OOP with a full house+. Unconditionally in 2-card FLH (~2.6% river full-house+ rate intersected with OOP, opponent turn barrel, non-underfull, `beatenAny <= 0.12`, and V11 check), natural reach is ~0.1%-0.35%. Measuring the option cleanly requires either `flo8` (4-card Omaha Hi-Lo makes full houses+ ~4-5x more frequently and is where 42%-50% of HU checks checked through in `AD-STRONG-RIVER-CHECKS.md`) or a non-maniac c-betting/turn-barrelling FLH script that checks back medium/missed rivers.
- Reach against people: NOT MEASURED.
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 7 diverged, -0.01 +/- 0.06 bb/100; production personas, 600 pairs: 2 diverged, -0.06 +/- 0.12. Neither is significant.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. A field in which the option acts at a measurable rate, or a count from recorded fixed-limit hands of how often the gate is reached with the reference checking (Reach). Without one of them there is nothing to price.
2. The Value row: three opponent ranges, one value-only, with a per-node table.
3. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitRiverStrongHandLeads'`, `state = 'on'`, note `authority: fixedLimitRiverStrongHandLeads docs/horse-option-authority.d/fixedLimitRiverStrongHandLeads.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)

## Rollback

If enabled, run `horse-option-switch.mjs set fixedLimitRiverStrongHandLeads off --rollback` (`fn_ca_horse_option_switch_set('fixedLimitRiverStrongHandLeads', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
