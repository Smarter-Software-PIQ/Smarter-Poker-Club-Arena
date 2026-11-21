# fixedLimitStealVsTightBlinds: authority for the live switch

Owner hold, not lifted. Evidence NOT MET: the option is off-only in the registry (`optionSwitchOffOnly`: status `hold`, source "owner hold: blind steal; owner ruling 2026-11-14 21:30 Chicago (tight steal responses stay OFF)", reason "a steal option: held until the owner lifts it by name") and it widens a preflop first-in range, which is what the owner preflop range hold covers. This file does not lift the hold and proposes no switch row.

## What it does

Fixed-limit cash tables only (inert at every tournament table). First in from the cutoff, the button or the small blind (or the heads-up button), when every player still to act has his own over-folder read (postflop fold to a bet engaged high on at least 15 decayed opportunities, not presumed, no preflop statistic engaged wide) and none is all in, the open share widens by up to 15 points, scaled by the weakest read's excess (`server/src/engine/HorseFixedLimitPreflop.ts`; Fixed-Limit lane W5).

## The order it rests on

None to switch it on. The hold above stands until the owner lifts it by name (the precedent is `OPTION_SWITCH_PREFLOP_HOLD_LIFTED`, #11538, for one heads-up option).

## Receipts and tests

Receipt `fixed_limit_steal_vs_tight_blinds`. Law `server/src/engine/AFixedLimitStealsFromOverFoldingBlinds.law.test.ts`. League cards `flh_steal_vs_tight_blinds_vs_over_folding_blinds` and its harm control `flh_steal_vs_tight_blinds_vs_preflop_defending_blinds` (`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, pinned by `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (6 seats)                                                                                                          | Pairs per seed | Seed 20261120                         | Seed 20261121                         | Seeds together                       |
| ----------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------- | ------------------------------------- | ------------------------------------ |
| `flh_steal_vs_tight_blinds_vs_over_folding_blinds` (favourable range)                                                   | 10,000         | +7.00 +/- 0.39, 388 diverged          | +6.68 +/- 0.39, 353 diverged          | +6.84 +/- 0.28, z 24.68, SIGNIFICANT |
| `flh_steal_vs_tight_blinds_vs_preflop_defending_blinds` (harm control: defends 80% preflop, folds every postflop wager) | 10,000         | +6.41 +/- 0.62, z 10.40, 427 diverged | +6.18 +/- 0.59, z 10.42, 382 diverged | +6.29 +/- 0.43, z 14.72, SIGNIFICANT |
| `flh_steal_vs_tight_blinds_vs_value_only_blinds` (harm control: value-only range; card not kept)                        | 20,000         | +0.03 +/- 0.02, z 1.31, 2 diverged    | +0.02 +/- 0.01, z 1.41, 2 diverged    | +0.02 +/- 0.01, z 1.84, not resolved |

Measured 2026-11-21 on the working tree of this file's pull request (base 5bfaa38d0). The block standard errors were 0.44 and 0.49. A development probe at seed 20261115 (3,000 pairs) read +6.47 +/- 0.74, 109 diverged. The two harm-control rows were measured on 2026-11-21 (second pass, base 8d01508d3) with sizes fixed before the runs from development probes at seed 20261115, 3,000 pairs each: preflop-defending +5.45 +/- 1.08, 121 diverged; value-only 0 diverged. Block standard errors 0.70 and 0.72 (preflop-defending), 0.02 and 0.02 (value-only). A Horse mirror moves nothing: 0 of 300 pairs (seed 20261115).

- Mechanism: MET by the law's fixtures.
- Value: three ranges now, none negative, and the per-node table below; still NOT MET as a whole because two of the three ranges are design values chosen here and the third barely lets the option act. The favourable range `flh_over_folding_blinds_v1` (never raises, folds a six-max blind to one raise 82% of the time, folds to every postflop wager; DESIGN VALUE): +6.84 +/- 0.28. The harm control asked for, blinds whose postflop fold read is high but who defend 80% of their hands preflop (`flh_preflop_defending_blinds_v1`, defence width from the published references quoted in `HorseFixedLimitPreflop.ts`, postflop a DESIGN VALUE): +6.29 +/- 0.43, still positive, because every widened open they call is won by a postflop bet they always fold to. The value-only range (`flh_value_only_blinds_v1`: tight-value raise or fold preflop, continues postflop only with two pair or better): 2 of 20,000 pairs per seed, +0.02 +/- 0.01, not resolved; the option almost never acts against it because the over-folder read does not fill against a player whose folds are mixed by his cards (below). Sensitivity: the gain comes from the postflop folds, not the preflop ones; a blind that defends preflop and also continues postflop is not built.
- Per-node table of changed decisions (2026-11-21; `npx tsx src/scripts/leagueChangedNodeTable.ts`, `server/src/benchmark/LeagueChangedNodeTable.ts`, the two kept cards at their recorded seeds and sizes; each card's bb/100 reproduced the rows above exactly; 0 unexplained pairs). A node is the street, facing a wager or checked to, and the bets and raises already on the street, the blinds not counted: `preflop/facing_0` is a first-in decision facing only the blinds. Mean is arm A minus arm B, big blinds per changed pair, both seeds pooled.

| Range                    | Node             | On    | Off   | Changed pairs (20261120 + 20261121) | Mean A-B | Std. error | z     |
| ------------------------ | ---------------- | ----- | ----- | ----------------------------------- | -------- | ---------- | ----- |
| over-folding blinds      | preflop/facing_0 | raise | fold  | 727 (383 + 344)                     | +1.86    | 0.035      | 53.92 |
| over-folding blinds      | preflop/facing_0 | raise | call  | 94 (48 + 46)                        | +0.15    | 0.037      | 4.03  |
| over-folding blinds      | flop/checked_to  | check | bet   | 1 (0 + 1)                           | 0.00     | n/a        | n/a   |
| over-folding blinds      | turn/checked_to  | bet   | check | 1 (0 + 1)                           | 0.00     | n/a        | n/a   |
| preflop-defending blinds | preflop/facing_0 | raise | fold  | 739 (392 + 347)                     | +1.61    | 0.100      | 16.10 |
| preflop-defending blinds | preflop/facing_0 | raise | call  | 96 (50 + 46)                        | +0.76    | 0.044      | 17.36 |

Per seed at `preflop/facing_0` raise against fold: +1.82 +/- 0.05 and +1.92 +/- 0.05 (over-folding), +1.54 +/- 0.14 and +1.68 +/- 0.15 (preflop-defending). The option's own decision is the first-in open (raise where the reference folds, or raises where it would complete the small blind); 821 of 823 and all 835 changed pairs sit there. The value-only blinds changed 4 pairs in 40,000 and have no table. Sensitivity: defending 80% preflop instead of 18% costs the widened open about a quarter of a big blind per changed fold-to-raise decision (+1.86 to +1.61) and adds to the completed-blind node, because the defending blind then folds every postflop bet.

- Reach finding (investigated 2026-11-21): the over-folder read rarely fills against a stable player whose preflop raising is mixed. `HorseOpponentExploit.styleShiftReleased` compares fast and long window rates with a fixed 0.2 gap and no noise allowance, a release from any statistic ages every long-window gated statistic, and a stable 26% first-in raiser who faces a postflop bet on 3% of hands keeps on average 11.7 decayed fold opportunities (at least 15 on 22.5% of hands) against 34.1 (100%) with the release forced off (simulation of the real functions, `docs/horse-league-fixed-limit.md`, "The over-folder read and mixed frequencies"). That is a defect against the release's stated intent, but the rule is default-on for every Horse's memory with an SQL twin and owner-ruled parameters, so it is reported, not changed here. Until it is resolved, the option's reach against people with mixed frequencies is small, and how small is NOT MEASURED.
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 0 diverged; production personas, 600 pairs: 0 diverged.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. The owner hold lifted by name. Evidence work does not lift it.
2. Done 2026-11-21: both harm controls and the per-node table (above). Still open in the Value row: a defending blind that also continues postflop, and thresholds from a record rather than design values.
3. Reach: how many recorded fixed-limit first-in decisions against people would change, with the reads those opponents actually carried.
4. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
5. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".

## What the activation row must contain

`option = 'fixedLimitStealVsTightBlinds'`, `state = 'on'`, note `authority: fixedLimitStealVsTightBlinds docs/horse-option-authority.d/fixedLimitStealVsTightBlinds.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
