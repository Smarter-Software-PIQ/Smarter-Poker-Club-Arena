# Fixed limit: steal harm controls, per-node tables, mirror re-runs, people count, and the style-shift release drain

2026-11-21, second pass on the fixed-limit league after PR #11603. Measurement plumbing and documentation only: no option changes its default or its off-only status, no switch row, no migration, and nothing a live Horse decides changes.

## What was built

- Two scripted fixed-limit personas, the harm controls for `fixedLimitStealVsTightBlinds` (`server/src/benchmark/FixedLimitScriptedField.ts`):
  - `flh_value_only_blinds_v1`: the tight-value raise or fold preflop (sourced, `ExploiterLeague.ts` `regPreflop` / `openTop`); after the flop it continues only with two pair or better and raises it, folds everything else to a wager (DESIGN VALUE).
  - `flh_preflop_defending_blinds_v1`: never raises; calls a single raise at the blind defence widths quoted in `HorseFixedLimitPreflop.ts` REFERENCES (80% at three to six seats, 88% heads-up, 50% above six); folds to every postflop wager (DESIGN VALUE).
- Card `flh_steal_vs_tight_blinds_vs_preflop_defending_blinds` on `FIXED_LIMIT_SCRIPTED_FIELD_CARDS`. The value-only card was measured and is not kept (almost inert; the refusal reason of `flh_steal_vs_tight_blinds` records it).
- The per-node table of changed decisions the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` asks for: `server/src/benchmark/LeagueChangedNodeTable.ts` (a read-only `LeagueFieldPairObserver`, passed as `runMatchup`'s new optional fifth argument, human-field cards only) and `server/src/scripts/leagueChangedNodeTable.ts`. Every card's result with the observer equals its result without it (checked on every run).

## What was measured

All at the working tree of this change (base 8d01508d3), 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks in every run. Sizes fixed before the runs at seeds 20261120 and 20261121 from development probes at seed 20261115; no sample was enlarged after a result.

| Card                              | Pairs per seed | 20261120                     | 20261121                     | Together                             |
| --------------------------------- | -------------- | ---------------------------- | ---------------------------- | ------------------------------------ |
| steal vs preflop-defending blinds | 10,000         | +6.41 +/- 0.62, 427 diverged | +6.18 +/- 0.59, 382 diverged | +6.29 +/- 0.43, z 14.72              |
| steal vs value-only blinds        | 20,000         | +0.03 +/- 0.02, 2 diverged   | +0.02 +/- 0.01, 2 diverged   | +0.02 +/- 0.01, z 1.84, not resolved |

Development probes at seed 20261115, 3,000 pairs: preflop-defending +5.45 +/- 1.08 (121 diverged); value-only 0 diverged.

Per-node tables: `fixedLimitRiverOneBetValueRaise` against the maniac, tight-value and passive-caller cards at their recorded sizes and seeds (each card's bb/100 reproduced exactly); `fixedLimitStealVsTightBlinds` against the over-folding and preflop-defending blinds. The tables are in the two options' authority files.

Horse-mirror re-runs after the 2026-11-20 league memory fix (Hybrid cash 2,000 pairs and production personas 600 pairs, seed 20261120, every fixed-limit hold'em option): no reading that existed before the fix moved; none is significant. Table in `docs/horse-league-fixed-limit.md`. The default-on record of `fixedLimitBetsAreNeverProbes` does not rest on these rows and is unchanged.

People at fixed-limit tables, counted read-only from production `hand_history.has_human` at 15:10 UTC: flh 0 hands ever; flo8 107 hands at one table on 2026-11-03, one person. Recorded in every fixed-limit authority file: no audited fixed-limit-versus-people decision set can be built for hold'em.

## The reach defect, found and not fixed here

`HorseOpponentExploit.styleShiftReleased` releases when any of six fast-window rates differs from its long-window rate by 0.2 on at least 3 decayed fast opportunities, with no allowance for sampling noise, and a release ages every long-window gated statistic. A stationary player whose preflop raising is mixed trips it on 2% to 4% of hands, which cuts a rarely reached statistic to about a third (a 26% first-in raiser who faces a postflop bet on 3% of hands: 11.7 decayed fold opportunities, at least 15 on 22.5% of hands; 34.1 and 100% with the release forced off). That defeats what the 2026-11-06 opportunity-scoped decay was built for and is why the over-folder read rarely fills against a mixed player. The rule is default-on for every Horse's memory, has an SQL twin (`fn_horse_exploit_add`) that must change with it, and its parameters were ruled on by the owner on 2026-11-06, so it is reported to the coordinator with the evidence rather than changed. Full measurement and reproduction: `docs/horse-league-fixed-limit.md`, "The over-folder read and mixed frequencies".

## Status

Every fixed-limit option's authority file still says Evidence NOT MET. `fixedLimitRiverOneBetValueRaise` now meets the Value row in the league (positive at its own node in all three ranges); its Replay row stays NOT RUN and cannot run. `fixedLimitStealVsTightBlinds` has its two harm controls and its per-node table and stays under the owner hold.
