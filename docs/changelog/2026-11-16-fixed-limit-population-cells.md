# Fixed limit reads an opponent against the fixed-limit Horse population (default off)

Fixed-Limit lane, 2026-11-16, Phase 3. Design: agent evidence `fixed-limit-01Gw7aDr/P3-TIGHT-READ-DESIGN.md` section 4; evaluation pre-declared in `AB-0.19-PREDECLARATION.md` and recorded in `AB-EVALUATION-2.md` section 3.13. DEFAULT OFF (`HorseDecideOpts.fixedLimitPopulationCells`, read as `=== true`); nothing turns it on.

## The defect

The style and exploit reads judge an opponent against the Horse population cell of his game and table size (`exploitEnvelopeFor`). The 2026-10-16 fixed-limit cells were sparse (a few horses, +/- 0.20 bands) and there was no full-ring flo8 cell, so a full-ring flo8 read borrowed flo8 short-handed: a VPIP mean of 0.526 against the 0.31 Horses actually play there. An ordinary full-ring flo8 player read tight; at full-ring flh the band was centred too wide for the tight consumers to separate a tight player from an ordinary one.

## Scope: fixed-limit hold'em only

At the lane owner's decision on `AB-EVALUATION-2.md` section 3.13 the option acts only at flh (`FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE`, as the W5 options were scoped). flo8 was measured and is out of scope by code: at six seats against the Horse field the option lost 2.29 +/- 0.71 BB/100 (3.2 standard errors, almost all preflop) and showed no gain against the true-tight script, so a flo8 decision with the option on is exactly a decision with it off. The flo8 cells stay in the frozen table as measured; no read takes them. The option moves tight-player reads that feed preflop decisions (tight-opener and tight-reraiser respect), so it falls under the owner's preflop range hold: it ships OFF, and turning it on needs the owner to lift the hold for it by name and Hand Analysis's evidence route.

## The change

`FIXED_LIMIT_POPULATION_ENVELOPE` (version `fixed-limit-population-2026-11-16`) is frozen in `HorseOpponentExploit.ts`: six cells (flh and flo8, heads-up, short-handed and full ring) measured from 107,538 Horse-only fixed-limit cash hands dealt 2026-11-09T04:00Z to 2026-11-16T04:00Z (662,790 Horse seat-hands, public actions only, no hole cards), with the same increments and decay the live learner uses. Band rule per statistic: P1-P99 of per-Horse rates when 30 or more Horses have 40 or more opportunities, else a beta-binomial method-of-moments band (pooled +/- max(2.33 sd, 0.08)) when 10 or more have 3 or more, else the sparse +/- 0.20 rule; nothing is borrowed. Generator: `server/src/scripts/fixedLimitPopulationEnvelope.ts` over `server/src/benchmark/FixedLimitPopulationEnvelope.ts`; the census of Horse counters it also writes is `server/src/engine/fixtures/fixed-limit-population-census.json`.

With the option on, a fixed-limit hold'em decision (`bettingStructureFor(variant) === 'fixed_limit'` and the variant in scope) reads its own frozen cell `${variant}:${size}`; every other read, and every read with the option off or outside a decision, is exactly main's envelope. Thresholds, margins, minimum hands and credibility are unchanged. The option travels beside the decision scope (`HorseMind.setDecisionReadOptions`) and is part of the style memo key; read frames and receipts name the envelope version they used. Receipt `fixed_limit_population_cell_read`; live switch entry owned by Fixed-Limit (migration `20261116043627_horse_option_switch_fixed_limit_population_cells.sql`, a follow-up of the option switch generator); refused league matchup `flh_population_cells` (the league deals no fixed limit; a flo8 card would be inert and has none). Law `AFixedLimitPopulationCells.law.test.ts`.

## Finding: today's fixed-limit tight labels are mostly false

Every Horse's own decayed counters from the same export, replayed through the style read (share of Horse identities, option off -> on; participation tight / tight-opener respect): flh heads-up 2.6% -> 1.1% / 0 -> 0; flh short-handed 8.1% -> 3.9% / 1.1% -> 0.3%; flh full ring 35.2% -> 18.2% / 14.1% -> 0.9%; flo8 heads-up 4.9% -> 2.4%; flo8 short-handed 57.2% -> 15.0%; flo8 full ring 73.8% -> 26.7% (tight-opener respect never acts in an Omaha scope). With the current cells a large share of ordinary Horses reads tight; the option lowers every count. The participation label reads tight relative to half the band, not outside it, so part of the Horse distribution keeps the label with the option on; that rule is unchanged.

## Not done

Turning it on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`. No store is read or written differently.
