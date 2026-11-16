# Fixed limit reads an opponent against the fixed-limit Horse population (default off)

Fixed-Limit lane, 2026-11-16, Phase 3. Design: agent evidence `fixed-limit-01Gw7aDr/P3-TIGHT-READ-DESIGN.md` section 4; evaluation pre-declared in `AB-0.19-PREDECLARATION.md` and recorded in `AB-EVALUATION-2.md` section 3.13. DEFAULT OFF (`HorseDecideOpts.fixedLimitPopulationCells`, read as `=== true`); nothing turns it on.

## The defect

The style and exploit reads judge an opponent against the Horse population cell of his game and table size (`exploitEnvelopeFor`). The 2026-10-16 fixed-limit cells were sparse (a few horses, +/- 0.20 bands) and there was no full-ring flo8 cell, so a full-ring flo8 read borrowed flo8 short-handed: a VPIP mean of 0.526 against the 0.31 Horses actually play there. An ordinary full-ring flo8 player read tight; at full-ring flh the band was centred too wide for the tight consumers to separate a tight player from an ordinary one.

## The change

`FIXED_LIMIT_POPULATION_ENVELOPE` (version `fixed-limit-population-2026-11-16`) is frozen in `HorseOpponentExploit.ts`: six cells (flh and flo8, heads-up, short-handed and full ring) measured from 107,538 Horse-only fixed-limit cash hands dealt 2026-11-09T04:00Z to 2026-11-16T04:00Z (662,790 Horse seat-hands, public actions only, no hole cards), with the same increments and decay the live learner uses. Band rule per statistic: P1-P99 of per-Horse rates when 30 or more Horses have 40 or more opportunities, else a beta-binomial method-of-moments band (pooled +/- max(2.33 sd, 0.08)) when 10 or more have 3 or more, else the sparse +/- 0.20 rule; nothing is borrowed. Generator: `server/src/scripts/fixedLimitPopulationEnvelope.ts` over `server/src/benchmark/FixedLimitPopulationEnvelope.ts`; the census of Horse counters it also writes is `server/src/engine/fixtures/fixed-limit-population-census.json`.

With the option on, a fixed-limit decision (`bettingStructureFor(variant) === 'fixed_limit'`) reads its own frozen cell `${variant}:${size}`; every other read, and every read with the option off or outside a decision, is exactly main's envelope. Thresholds, margins, minimum hands and credibility are unchanged. The option travels beside the decision scope (`HorseMind.setDecisionReadOptions`) and is part of the style memo key; read frames and receipts name the envelope version they used. Receipt `fixed_limit_population_cell_read`; live switch entry owned by Fixed-Limit (migration `20261116043627_horse_option_switch_fixed_limit_population_cells.sql`, a follow-up of the option switch generator); refused league matchups `flh_population_cells` and `flo8_population_cells` (the league deals no fixed limit). Law `AFixedLimitPopulationCells.law.test.ts`.

## Not done

Turning it on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`. No store is read or written differently.
