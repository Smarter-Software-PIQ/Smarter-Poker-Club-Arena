# fixedLimitRiverOneBetValueRaise: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). The league is significantly positive against one scripted range, passes the two-standard-error rule against a second only with two seeds together, and is not resolved against the value-only one. Since 2026-11-21 the per-node table exists: at the option's own node (a river raise instead of a call facing one bet) the value is positive under all three ranges, significant against two of them and not resolved against the value-only one. The replay on audited decisions does not exist and cannot be run: no fixed-limit hold'em hand a person was dealt into has ever been recorded.

## What it does

Fixed-limit hold'em, river, facing exactly one wager on an uncapped street: the value raise uses the one-bet break-even (0.60 plus the multiway and domination terms), with no stack-to-pot adjustment and no raise-frequency draw (`HorseDataLedger.ts`, SPEC-FL-03; HorseLogic value raise). Off (absent or false): never entered.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_river_one_bet_value_raise`. Law `server/src/engine/AFixedLimitStrongHandRaisesOneRiverBet.law.test.ts`. League cards `flh_river_one_bet_value_raise_vs_maniac`, `_vs_tight_value` and `_vs_passive_caller` (`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, pinned by `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (heads-up)                                   | Opponent range                                                      | Pairs per seed | Seed 20261120                       | Seed 20261121                       | Seeds together                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------- | -------------- | ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `flh_river_one_bet_value_raise_vs_maniac`         | bets every street, never folds                                      | 15,000         | +1.13 +/- 0.25, 91 diverged         | +1.67 +/- 0.28, 109 diverged        | +1.40 +/- 0.19, z 7.38, SIGNIFICANT                                            |
| `flh_river_one_bet_value_raise_vs_tight_value`    | value-only (harm control)                                           | 45,000         | +0.04 +/- 0.05, 61 diverged         | +0.10 +/- 0.05, 57 diverged         | +0.07 +/- 0.04, z 1.81, not resolved                                           |
| `flh_river_one_bet_value_raise_vs_passive_caller` | passive caller: bets two pair or better, never folds after the flop | 45,000         | +0.04 +/- 0.05, z 0.78, 60 diverged | +0.11 +/- 0.04, z 2.83, 60 diverged | +0.07 +/- 0.03, z 2.41, SIGNIFICANT (marginal; one seed of two resolves alone) |

The first two rows were measured on 2026-11-20 (PR #11565, `docs/horse-league-fixed-limit.md`); the third on 2026-11-21 on the working tree of this file's pull request (base 5bfaa38d0).

- Mechanism: MET by the law's fixtures.
- Value: MET in the league against scripted ranges (the per-node table below); not a production result. Three stated ranges, one value-only. At the option's node the raise is worth +2.14 +/- 0.25 big blinds per changed decision against the maniac (z 8.68), +0.50 +/- 0.21 against the passive caller (z 2.33) and +0.46 +/- 0.28 against the value-only player (z 1.63, not resolved). Sign: positive in every range; sensitivity: the value falls from about one big bet against a player who pays off every raise to under a quarter of one against players who fold or only call with worse.

### Per-node table of changed decisions (2026-11-21)

Made with `npx tsx src/scripts/leagueChangedNodeTable.ts --card=<card> --seed=<seed> --pairs=<pairs>` from server/ (`server/src/benchmark/LeagueChangedNodeTable.ts`, a read-only observer on the same `runMatchup` the card runs), on the three cards above at the same seeds and sizes. Each card's bb/100, standard error and divergent pairs reproduced the rows above exactly. In every divergent pair the first hero decision the two arms disagree on is found, and the pair's hero result (arm A minus arm B, big blinds) is booked to that node: the value of the changed decision together with everything it caused. A node is the street, facing a wager or checked to, and the bets and raises already on the street (`river/facing_1`: facing one river bet). Both seeds pooled; 0 unexplained pairs (a result that differs with no changed hero decision) in all six runs.

| Range          | Node             | On    | Off   | Changed pairs (20261120 + 20261121) | Mean A-B, big blinds per pair | Std. error | z     |
| -------------- | ---------------- | ----- | ----- | ----------------------------------- | ----------------------------- | ---------- | ----- |
| maniac         | river/facing_1   | raise | call  | 195 (91 + 104)                      | +2.14                         | 0.25       | 8.68  |
| maniac         | river/facing_3   | raise | call  | 6 (3 + 3)                           | +2.00                         | 0.00       | n/a   |
| maniac         | river/facing_3   | call  | raise | 5 (0 + 5)                           | -2.00                         | 0.00       | n/a   |
| tight value    | river/facing_1   | raise | call  | 113 (58 + 55)                       | +0.46                         | 0.28       | 1.63  |
| tight value    | river/facing_3   | raise | call  | 4 (3 + 1)                           | +2.00                         | 0.00       | n/a   |
| tight value    | turn/checked_to  | check | bet   | 3 (1 + 2)                           | +0.67                         | 2.40       | 0.28  |
| tight value    | river/facing_3   | call  | raise | 2 (1 + 1)                           | -1.00                         | 1.00       | -1.00 |
| tight value    | river/checked_to | bet   | check | 1 (1 + 0)                           | -2.00                         | n/a        | n/a   |
| tight value    | river/checked_to | check | bet   | 1 (0 + 1)                           | +2.00                         | n/a        | n/a   |
| tight value    | turn/facing_1    | fold  | call  | 1 (1 + 0)                           | +2.00                         | n/a        | n/a   |
| tight value    | turn/facing_1    | call  | fold  | 1 (1 + 0)                           | -2.00                         | n/a        | n/a   |
| passive caller | river/facing_1   | raise | call  | 120 (61 + 59)                       | +0.50                         | 0.21       | 2.33  |
| passive caller | river/facing_3   | raise | call  | 3 (2 + 1)                           | +0.67                         | 1.33       | 0.50  |
| passive caller | river/facing_3   | call  | raise | 2 (1 + 1)                           | 0.00                          | 0.00       | n/a   |
| passive caller | river/checked_to | check | bet   | 1 (0 + 1)                           | +2.00                         | n/a        | n/a   |

Per seed at `river/facing_1`: maniac +1.80 +/- 0.38 and +2.44 +/- 0.33; tight value +0.14 +/- 0.40 and +0.80 +/- 0.39; passive caller +0.20 +/- 0.33 and +0.81 +/- 0.27.

Reading it. The option's gate is a river decision facing exactly one wager, so `river/facing_1` is the only node it decides; it holds 428 of the 458 changed pairs. Every other row is a node the option's code does not enter (its gate, `HorseFixedLimitWagerRead.fixedLimitOneBetValueRaise`, needs exactly one wager on the river: not three, not none, not the turn). Read from the code, not measured: once two passes of a card have played one pair differently, the hero's memory of the scripted opponents and the order of its random draws (the option removes a raise-frequency draw) differ between the passes, so later pairs can first differ at any node. Those rows are small and mixed in sign (net +2 big blinds over 11 pairs against the maniac, +8 over 13 against the tight-value player, +4 over 6 against the passive caller).

- Continuation: every continuation is played out by the scripts; how a real fixed-limit player continues after a river raise is NOT MEASURED (no flh hand with a person exists, below).
- Reach: 91 and 109 of 15,000 pairs against the maniac, 61 and 57 of 45,000 against the tight-value player, 60 and 60 of 45,000 against the passive caller; 0 of 300 in a Horse mirror (seed 20261115). Reach against people: NOT MEASURED.
- Scope: fixed-limit hold'em only by its gate; flo8 is not dealt by the league.
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): heads-up, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 3 diverged, +0.05 +/- 0.09 bb/100; production personas, 600 pairs: 0 diverged.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Limits: scripted opponents are not people; simulated totals are not production gains; the solver stores were empty.

## What is still owed before this file may say the evidence is met

1. Done 2026-11-21: the per-node table above. What it cannot show is how people respond; that needs the replay below.
2. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
3. A PASS-BAR for that replay, declared in this file before it runs, then the run rows copied unedited under "Replay" with newlyWrong not above fixed in every row.
4. Three significant positive league runs are the bar for a source default; one card is clearly significant so far (the maniac), one marginally.
5. An order to activate, recorded verbatim above, and the serving engine containing the option.

## What the activation row must contain

`option = 'fixedLimitRiverOneBetValueRaise'`, `state = 'on'`, note `authority: fixedLimitRiverOneBetValueRaise docs/horse-option-authority.d/fixedLimitRiverOneBetValueRaise.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
