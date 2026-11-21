# fixedLimitRiverOneBetValueRaise: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). The league is significantly positive against one scripted range, passes the two-standard-error rule against a second only with two seeds together, and is not resolved against the value-only one; the per-node value table and the replay on audited decisions do not exist.

## What it does

Fixed-limit hold'em, river, facing exactly one wager on an uncapped street: the value raise uses the one-bet break-even (0.60 plus the multiway and domination terms), with no stack-to-pot adjustment and no raise-frequency draw (`HorseDataLedger.ts`, SPEC-FL-03; HorseLogic value raise). Off (absent or false): never entered.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_river_one_bet_value_raise`. Law `server/src/engine/AFixedLimitStrongHandRaisesOneRiverBet.law.test.ts`. League cards `flh_river_one_bet_value_raise_vs_maniac`, `_vs_tight_value` and `_vs_passive_caller` (`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, pinned by `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (heads-up) | Opponent range | Pairs per seed | Seed 20261120 | Seed 20261121 | Seeds together |
| --- | --- | --- | --- | --- | --- |
| `flh_river_one_bet_value_raise_vs_maniac` | bets every street, never folds | 15,000 | +1.13 +/- 0.25, 91 diverged | +1.67 +/- 0.28, 109 diverged | +1.40 +/- 0.19, z 7.38, SIGNIFICANT |
| `flh_river_one_bet_value_raise_vs_tight_value` | value-only (harm control) | 45,000 | +0.04 +/- 0.05, 61 diverged | +0.10 +/- 0.05, 57 diverged | +0.07 +/- 0.04, z 1.81, not resolved |
| `flh_river_one_bet_value_raise_vs_passive_caller` | passive caller: bets two pair or better, never folds after the flop | 45,000 | +0.04 +/- 0.05, z 0.78, 60 diverged | +0.11 +/- 0.04, z 2.83, 60 diverged | +0.07 +/- 0.03, z 2.41, SIGNIFICANT (marginal; one seed of two resolves alone) |

The first two rows were measured on 2026-11-20 (PR #11565, `docs/horse-league-fixed-limit.md`); the third on 2026-11-21 on the working tree of this file's pull request (base 5bfaa38d0).

- Mechanism: MET by the law's fixtures.
- Value: NOT MET. The row asks for the value at each changed node under at least three stated opponent ranges, one of them value-only, in a per-node table. Three ranges are now measured in aggregate (the maniac significant and positive; the passive caller positive past two standard errors only with the seeds together, one seed of two resolving alone; the value-only player not resolved; none negative); the per-node table of the changed decisions is not built (a `LeagueHandObserver` can record the nodes).
- Reach: 91 and 109 of 15,000 pairs against the maniac, 61 and 57 of 45,000 against the tight-value player, 60 and 60 of 45,000 against the passive caller; 0 of 300 in a Horse mirror (seed 20261115). Reach against people: NOT MEASURED.
- Scope: fixed-limit hold'em only by its gate; flo8 is not dealt by the league.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Limits: scripted opponents are not people; simulated totals are not production gains; the solver stores were empty.

## What is still owed before this file may say the evidence is met

1. The per-node table of changed decisions with the value of the raise against the call at each node under the three ranges (Value row).
2. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited.
3. A PASS-BAR for that replay, declared in this file before it runs, then the run rows copied unedited under "Replay" with newlyWrong not above fixed in every row.
4. Three significant positive league runs are the bar for a source default; one card is clearly significant so far (the maniac), one marginally.
5. An order to activate, recorded verbatim above, and the serving engine containing the option.

## What the activation row must contain

`option = 'fixedLimitRiverOneBetValueRaise'`, `state = 'on'`, note `authority: fixedLimitRiverOneBetValueRaise docs/horse-option-authority.d/fixedLimitRiverOneBetValueRaise.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
