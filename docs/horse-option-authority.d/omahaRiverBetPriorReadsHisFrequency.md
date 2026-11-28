# omahaRiverBetPriorReadsHisFrequency: Authority For The Live Switch

**State: OFF** (dark: source default OFF, no switch row; this file proposes none). PLO4 ONLY if trialled: publish `horse.omahaGameScope.omahaRiverBetPriorReadsHisFrequency` = 4 before any switch write (PLO5 is not cleared, see "Game Scope"). Built 2026-11-27 by lead-9 worker RFQ (session 01UxDLnJ) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaRiverBetPriorReadsHisFrequency`; compiled scope 0 = PLO4 and PLO5). It acts only inside `omahaFacingBetPriorIsPeopleMeasured` (on since 2026-11-27 08:39Z). **Evidence NOT MET**: the measurements are below and in `plo-lead7-01TLQer8/l9-rfq/BUILD.md`; this file does not authorize switching the option on.

## The Defect It Answers

Real-node replay (lead-9 RSR, base ecd95ce78974, recorded Horse decisions facing a PERSON's first river bet heads-up, Oct 27 - Nov 27, the deciding Horse's own cards only, seeds 1/7/42): a zero-equity bluff still profits in single-raised pots: PLO5 big (0.7-1.1 pot) +14.2 +/- 5.7 bb per bet in position / +20.2 +/- 6.8 out of position, PLO5 mid (0.4-0.7) +24.9 / +20.6, PLO4 mid +11.2 / +16.4. Calling more against the AVERAGE person there loses (the recorded calls the engine folds: -1.1 +/- 5.8 bb, n 47): people's single-raised river bets are 63-64% value. The only lawful lever is the bettor's OWN record, and a person's shown-bet record grows slowly.

People's heads-up river first bets by the bettor's own public river first-bet frequency (as of earlier days, shrunk; shown cards only; non-value = beats more than 20% of holdings): below 0.8x people's rate 33% non-value, 0.8-1.0x 42%, 1.0-1.2x 49%, above 1.2x 56% (all pots; 26,823 hands). The frequency is public for every river he reaches, shown or not.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), heads-up, the river, a first bet (never a raise), in a single-raised or limped pot, inside the people-measured facing-bet price:

1. His heads-up unopened river record (OPPONENT-HUD's lifetime `unopenedWagerRecord`, the same seam the turn stab record reads) is shrunk to people's measured rate f0 = 0.3437 (1,574 bets in 4,579 opportunities, 43 people) by 34 pseudo-opportunities (the beta-binomial k measured between people).
2. Value bets arrive at people's rate, so a shrunk frequency f above f0 implies a non-value share q = 1 - (1 - q0) f0 / f in the record's unit (q0 = people's share for the cell).
3. That share replaces q0 as the PRIOR MEAN of his shown-bet record (8 pseudo-bets). His shown bets still dominate as they grow: a bettor with a long, value-heavy shown record (every Horse in a long league run) is priced on his shown bets, and the frequency speaks where his shown record is thin.
4. Fold -> call only: the price with the frequency is used only where the price without it folds and it calls. A frequency at or below people's adds nothing.

No clamp of its own, no size rule, no identity input (person or Horse, name, account), no unshown card. It never raises. PLO6, tournaments, the flop, the turn, raises, re-raised pots (omahaRiverBetPriorIsPotTypeSplit) and multiway pots are untouched. Receipts `omaha_river_frequency_prior_read`, `omaha_river_frequency_prior_called`. Staged for shadow re-decision on the river.

## Game Scope

Fixed harness (server/scripts/horse-grade.ts), ON-minus-same-seed-no-op (no-op 0.00 with 0 divergent deals on every card), base = the live switch rows through 2026-11-28 01:32Z. Mirrors first (the risk named by the Hold'em frequency record, which failed its 6-max mirror at -5.85 +/- 0.98 because Horses bet rivers often with value):

| card (bb/100 per seat unless stated)                          | PLO4                                     | PLO5                                     | bar             | result               |
| ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | --------------- | -------------------- |
| mirror heads-up, 2 x 8,000 pairs (seeds 311, 312)             | +1.09 +/- 1.95 (+0.6 SE)                 | +1.33 +/- 2.56 (+0.5 SE)                 | not below -2 SE | PASS                 |
| mirror 6-max, 2 x 4,000 pairs                                 | -0.23 +/- 0.93 (-0.2 SE)                 | +0.24 +/- 1.19 (+0.2 SE)                 | not below -2 SE | PASS                 |
| people-calibrated responder, 2 x 8,000 deals (211, 212)       | -0.21 +/- 0.49 (-0.4 SE)                 | -0.97 +/- 0.88 (-1.1 SE)                 | >= -1 SE        | PLO4 PASS, PLO5 FAIL |
| value-only bettor, 2 x 8,000 deals                            | 0.00 (0 divergent deals)                 | 0.00 (0 divergent deals)                 | >= -3.0 / -4.0  | PASS                 |
| frequent river bluffer, no shown record (seed 601): river bet | -0.75 +/- 2.75 -> -14.44 +/- 2.33 bb/bet | +1.16 +/- 2.91 -> -12.11 +/- 2.64 bb/bet | ON not > +2 SE  | PASS                 |
| same bot: river all-fold, OFF -> ON (break-even 44%)          | 44% -> 18%                               | 45% -> 22%                               |                 |                      |
| production-muck bluffer bp (seed 601): air bb per line        | -5.13 -> -5.16 +/- 0.76                  | -5.24 -> -5.46 +/- 0.90                  | not > +2 SE     | PASS                 |

The people responder answers bets like people but its own river bets are the production Horse's (a river first-bet frequency about 1.3x people's, value-heavy), so in PLO5 the option calls a few more of them (24 divergent deals in 16,000) and misses that bar by 0.1 SE. No tuning, no re-seed: PLO5 is NOT cleared, scope 4 (PLO4 only).

Real-node replay (1,101 recorded Horse decisions facing a person's first river bet heads-up in single-raised and limped pots, Oct 27 - Nov 27; as-of opponent memory, as-of shown-bet record and as-of river frequency record learned from public actions two or more days earlier; seeds 1/7/42): the option read 1,030 decisions and turned 12 folds into calls (PLO4 10, PLO5 2), no call into a fold. All 12 were recorded folds, so no realised chips exist for them (the bar on added calls is met with n 0 and says nothing). The single-raised cells barely move (PLO4 0.4-0.7 pot 73% -> 71% folds, still over the bar at +11.7 +/- 2.6 bb per bet): only about 7% of people's river bets come from a bettor betting above 1.2x people's rate, so against today's people the remaining over-fold there is the range fact measured by lead-9 RSR, priced correctly against the average person. What this option closes is the FREQUENT bettor whose shown record is thin (the bot card above).

Flag-off: 0 differences in 28,000 decisions (main 91844235b24e vs this branch's engine head d1aa7c2cd004). Cost law: 0.99 / 0.96 times off (telemetry off / on, limit 4; 40 real river decisions). Law tests 10 of 10 (254 committed river states: 186 read, 39 folds -> calls, nothing else changed).

## Watch And Rollback

- Roll back (switch off) if the realised chips of the river calls this option adds against people (receipt `omaha_river_frequency_prior_called`) are below zero by 2 SE after 30 such calls.
- Roll back if any breaker, error or decision over 50 ms appears in the shadow read.

## Prior anchor

- Baseline: equilibrium. The balanced share for the price (`omahaEquilibriumAnchor`) weighs 30 pseudo-bets behind the people cell, unchanged.
- Population weight: PEOPLE-ONLY heads-up unopened river first-bet rate (0.3437) and people's measured between-player spread (k 34); people's shown river cells as today.
- Own record: his own public river first-bet frequency sets the prior of his own shown river bets, which keep 8 pseudo-bets and dominate as they grow.
- No unshown cards: the measurement reads public actions and cards people showed at showdown; at decision time the option reads his public action counts and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 1; changed 2; unchanged 867; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer fb71286dad8; source placed verdict-only; arm FRQ vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 1; changed 13; unchanged 2684; unjudged 12; set PLO-hand-audit-2026-11-20-to-24; scorer fb71286dad8; source placed verdict-only; arm FRQ vs off; replayed 2697 of 2697
- Note (2026-11-27): the audit sets' switch rows predate omahaFacingBetPriorIsPeopleMeasured's switch-on, so both arms carry it: arm FRQ = omahaFacingBetPriorIsPeopleMeasured + this option, arm BASE = omahaFacingBetPriorIsPeopleMeasured alone, opponent memory off. BASE gives exactly the same two rows (same 2 and 13 changes, same 1 newly wrong each): this option changes NO audited decision (with no opponent record served it never reads a frequency), so the rows measure the people-measured prior, not this option, and the bar (fixed >= 2 x newly wrong) says nothing about it. The evidence is the harness cards and the real-node replay above.
