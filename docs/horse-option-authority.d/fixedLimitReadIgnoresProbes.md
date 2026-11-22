# fixedLimitReadIgnoresProbes: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). The one significant league result is against a scripted maniac carrying a scripted no-limit probe history; against the value-only player the option is inert, and no replay on audited decisions exists.

## What it does

At a fixed-limit decision (flh, flo8), with the process switch `fixedLimitBetsAreNeverProbes` on, an opponent's pooled no-limit and pot-limit probe share does not discount his fixed-limit aggression read (`HorseMind.probeAdjusted`, "F1b", its own option since 2026-11-16). Off: the read is discounted as before.

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_read_probe_discount_withheld`. Law `server/src/engine/AFixedLimitReadIsNeverProbeDiscounted.law.test.ts`. League cards `flh_read_ignores_probes_vs_maniac` and `_vs_tight_value`, each after 300 no-limit hold'em hands played into both pass sandboxes (`LeagueMatchup.probeHistoryHands`; without them the option is inert by construction).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

League figures are arm A (option on) minus arm B (off) in bb/100 +/- standard error, big blinds (a fixed-limit big blind is the small bet), one hero Horse on the live cash Hybrid persona against the scripted field `flh_scripted_field_v1` (`server/src/benchmark/FixedLimitScriptedField.ts`), run with `npx tsx src/scripts/horseLeagueCard.ts` from server/ with empty solver stores. Significant means |bb/100| > 2 standard errors. Every run listed had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks.

| Card (6 seats, 300 no-limit hands first)                | Pairs per seed | Seed 20261120                     | Seed 20261121                     | Seeds together                          |
| ------------------------------------------------------- | -------------- | --------------------------------- | --------------------------------- | --------------------------------------- |
| `flh_read_ignores_probes_vs_maniac`                     | 10,000         | +226.30 +/- 24.58, 3,283 diverged | +231.46 +/- 24.76, 3,305 diverged | +228.88 +/- 17.44, z 13.12, SIGNIFICANT |
| `flh_read_ignores_probes_vs_tight_value` (harm control) | 45,000         | -0.00 +/- 0.00, 1 diverged        | 0.00 +/- 0.00, 0 diverged (INERT) | not resolved                            |

Measured 2026-11-20 (PR #11565, `docs/horse-league-fixed-limit.md`), after that pull request's league memory fix.

- Mechanism: MET by the law's fixtures.
- Value: NOT MET. The maniac result is driven by the script's own probe history: the warm-up script's every bet is a probe by rule (a DESIGN VALUE, not the lane's seeding), so the size of the gain is a property of that script. Against every other scripted fixed-limit persona with the same 300-hand no-limit probe warm-up (measured 2026-11-21, base `f90aa478ae35`, seed 20261120, 500 pairs each, 0 illegal/truncated/fallbacks), the option is inert or near-inert because none of them triggers fixed-limit maniac/aggressor thresholds: `flh_passive_caller_v1` 0/500 diverged (INERT), `flh_over_folding_blinds_v1` 0/500 diverged (INERT), `flh_preflop_defending_blinds_v1` 0/500 diverged (INERT), `flh_defending_postflop_blinds_v1` 0/500 diverged (INERT), `flh_value_only_blinds_v1` 1/500 diverged (-0.20 +/- 0.20 bb/100, not resolved).
- Per-node table of changed decisions on `flh_read_ignores_probes_vs_maniac` (2026-11-21; `npx tsx src/scripts/leagueChangedNodeTable.ts`, base `f90aa478ae35`, 1,000 pairs per seed across seeds 20261120 and 20261121 = 2,000 pairs pooled: seed 20261120 +152.10 +/- 68.41, 315 diverged / 322 changed; seed 20261121 +340.00 +/- 87.04, 334 diverged / 342 changed; pooled +246.05 +/- 55.35 bb/100, z 4.45, 649 diverged / 664 changed, 0 unexplained, 0 illegal/truncated/fallbacks). The primary EV driver is calling capped multi-bet turn and river spots (`river/facing_4` +128.60 bb/100 share and `turn/facing_4` +63.80 bb/100 share, together +192.40 of +246.05 bb/100) that the probe-discounted arm folded:

| Node            | On   | Off  | Changed pairs (20261120 + 20261121) | Mean A-B (bb/pair) | Share of bb/100 |
| --------------- | ---- | ---- | ----------------------------------- | ------------------ | --------------- |
| river/facing_4  | call | fold | 76 (44 + 32)                        | +33.84             | +128.60         |
| turn/facing_4   | call | fold | 147 (69 + 78)                       | +8.68              | +63.80          |
| flop/facing_4   | call | fold | 249 (116 + 133)                     | +3.21              | +39.95          |
| turn/facing_3   | call | fold | 16 (7 + 9)                          | +11.63             | +9.30           |
| turn/facing_2   | call | fold | 12 (4 + 8)                          | +13.67             | +8.20           |
| river/facing_3  | call | fold | 13 (8 + 5)                          | +8.62              | +5.60           |
| river/facing_1  | call | fold | 8 (1 + 7)                           | +10.00             | +4.00           |
| turn/facing_1   | call | fold | 20 (13 + 7)                         | -2.00              | -2.00           |
| flop/facing_3   | call | fold | 46 (23 + 23)                        | -2.74              | -6.30           |
| flop/facing_1   | call | fold | 57 (26 + 31)                        | -3.47              | -9.90           |
| other (10 tiny) | misc | misc | 20 (11 + 9)                         | +4.80              | +4.80           |

- Continuation and reach against people: NOT MEASURED. No record here says how often a real fixed-limit opponent carries a pooled probe share large enough for the discount to act.
- Reach in a Horse mirror: 0 of 300 pairs (seed 20261115), 0 of 300 with production personas (seed 20261120).
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 0 diverged; production personas, 600 pairs: 0 diverged.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. A measurement of how many recorded fixed-limit decisions against people the discount changes (Reach), from the decision journal, with the probe shares those opponents actually carried.
2. Done 2026-11-21: per-node table for `flh_read_ignores_probes_vs_maniac` and inertness proof across all five other scripted FLH personas (above). Still open in the Value row: non-design-value probe-share seeding matching real player probe histories.
3. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitReadIgnoresProbes'`, `state = 'on'`, note `authority: fixedLimitReadIgnoresProbes docs/horse-option-authority.d/fixedLimitReadIgnoresProbes.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)

## Rollback

If enabled, run `horse-option-switch.mjs set fixedLimitReadIgnoresProbes off --rollback` (`fn_ca_horse_option_switch_set('fixedLimitReadIgnoresProbes', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
