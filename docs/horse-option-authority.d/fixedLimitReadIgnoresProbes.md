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
- Value: NOT MET. One favourable range. The maniac result is driven by the script's own probe history: the warm-up script's every bet is a probe by rule (a DESIGN VALUE, not the lane's seeding), so the size of the gain is a property of that script. No third range and no per-node table.
- Continuation and reach against people: NOT MEASURED. No record here says how often a real fixed-limit opponent carries a pooled probe share large enough for the discount to act.
- Reach in a Horse mirror: 0 of 300 pairs (seed 20261115), 0 of 300 with production personas (seed 20261120).
- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 0 diverged; production personas, 600 pairs: 0 diverged.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. A measurement of how many recorded fixed-limit decisions against people the discount changes (Reach), from the decision journal, with the probe shares those opponents actually carried.
2. A third opponent range and the per-node table of changed decisions (Value row).
3. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitReadIgnoresProbes'`, `state = 'on'`, note `authority: fixedLimitReadIgnoresProbes docs/horse-option-authority.d/fixedLimitReadIgnoresProbes.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
