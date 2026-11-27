# omahaMultiwayFieldIsPeopleMeasured: Authority For The Live Switch

Built 2026-11-27 by a PLO-OWNER lead-7 worker (session 01TLQer8) on Dan's orders of 2026-11-26 ("PLO4 cash needs adjustments too"; "the stats need to be used against human players, not horses"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaMultiwayFieldIsPeopleMeasured`). **Evidence NOT MET**: no grade below shows a significant chip gain; this file does not authorize switching the option on.

## The Defect It Answers

PLO4 cash, Nov 19 23Z to Nov 26 23Z, 1,978 hands with a person and a Horse seated (audit: `plo-lead7-01TLQer8/plo4-audit/FINDINGS.md`, SQL beside it): facing a first bet on a multiway turn the Horses fold 79.0% (n 138) where people fold 51.9% (n 52), z 3.7; facing a person's multiway turn bet 78.0% (n 41). Replay of every Horse facing-bet node on the live switch rows (3 seeds, the deciding Horse's own cards only) reproduces the live action at 98% of those nodes, and every multiway turn fold is the `omahaFacingBetEv` verdict (109 of 109; 29 of them turned the reference brain's call into a fold).

Inside that verdict the field factor multiplies the Horse's win share by its chance of beating every other player. A caller of the bet is the strongest `OMAHA_EV_CALLER_SHARE` of holdings (turn 0.45, river 0.35); a player still to act continues `OMAHA_EV_BEHIND_SHARE` (0.25) of the time with the strongest 0.25. Both are stated constants. People's own shown calls of turn / river bets lie where a uniform top 0.753 (n 1,473) / 0.58 (n 752) of holdings would (`HorseOmahaFacingBetPeoplePrior.data.ts`, people-only); people behind multiway continue 57% / 47% / 38% on the turn by size (n 486 / 528 / 391). The bettor side is not the cause: the verdict's non-value share at these nodes (mean 0.289) is close to people's multiway cell (0.275 to 0.347).

## What It Does

PLO4/PLO5 cash (tables and Lightning), turn and river, a facing-bet decision with a caller or a player still to act, inside `omahaFacingBetEvVerdict` (`HorseOmahaMultiwayPeopleField.ts`, wired in `HorseLogic.ts`):

- A caller holds the strongest W of holdings, W = (n x people caller width + 30 x 1 / (1 + s)) / (n + 30); a bet under a quarter of the pot keeps the verdict's own interpolation toward 1.
- A player still to act continues at C = 1 - (n x people multiway fold + 30 x (s / (1 + s))^(1/k)) / (n + 30), k = players left to answer including the Horse; continuing, he holds the strongest W.
- Everything else (bettor range, all-in share 0.5, realization, margin, the joint-field and shown-field options' own models) is unchanged. Heads-up is untouched (identical decisions, law test). PLO6, tournaments, hi-lo, bomb pots and hold'em are untouched. No input reads whether a player is a person or a Horse, a name or an account; no unshown card. It never raises (owner rules on non-nut turn/river raises untouched). Receipts `omaha_mw_people_field_priced`, `omaha_mw_people_field_changed`. Staged for shadow re-decision on the turn and river.

## What Was Measured

Real audited multiway decisions (162 PLO4 nodes of the audit; law test `anOmahaMultiwayFieldIsPeopleMeasured.law.test.ts`, engine's own decide on the live switch rows): priced 150; facing people's turn bets folds 32 -> 28 of 41; facing Horses' turn bets 77 -> 77 of 97; river 20 -> 19 of 24; 7 folds become calls, 2 calls become folds; nothing else changes. Of those 9 changed decisions, 4 reached a showdown with cards shown: the 2 new calls would have lost to the shown winner, the 2 new folds were right; the other 5 ended without showdown (unscored). Too few to judge either way.

Scripted probes and mirror (`plo-lead7-01TLQer8/plo4-audit/src/grade-mw.mts`, live switch rows as options, 6 seats PLO4 100 bb, seat 0 scripted and betting turn and river in any pot size including multiway, Horses ON world minus OFF world on duplicate deals; bb/100 for the Horses against seat 0):

| probe                                                      | deals       | Horses ON - OFF bb/100                                                                                |
| ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| nobluff (value-only bettor: the case it is most afraid of) | 12,000      | +1.32 +/- 1.71                                                                                        |
| balanced                                                   | 12,000      | +1.84 +/- 2.28                                                                                        |
| overbluff                                                  | 12,000      | -1.27 +/- 3.09                                                                                        |
| caller (calls every postflop bet)                          | 12,000      | -2.94 +/- 1.80                                                                                        |
| folder                                                     | 12,000      | +0.09 +/- 1.59                                                                                        |
| nobluff, 200 bb deep                                       | 6,000       | +2.25 +/- 1.79                                                                                        |
| mirror PLO4 6-max, ON seats vs OFF seats                   | 6,000 pairs | -0.26 +/- 0.63                                                                                        |
| mirror PLO5 6-max, ON seats vs OFF seats                   | 6,000 pairs | -0.04 +/- 0.65                                                                                        |
| mirror PLO4 heads-up (the option never acts heads-up)      | 6,000 pairs | +0.86 +/- 2.16 (harness noise: the same mirror with no option on gives +6.38 +/- 6.79 on 1,000 pairs) |

No probe shows a significant loss or a significant gain. Speed (relative-cost law, 40 audited multiway decisions, engine decide, source build): on 6.84 ms vs off 6.64 ms per decision with telemetry off (ratio 1.03), 6.70 vs 6.59 with telemetry on (ratio 1.02). Flag-off: `horse-flag-off-check.sh` full set, 0 differences in 28,000 decisions.

## Prior anchor

- Baseline: equilibrium. A caller keeps 1 / (1 + s) of his range against a bet of s pot; the players left to answer together let a pure bluff break even, each folding (s / (1 + s))^(1/k). The anchor weighs 30 pseudo-observations; it is the whole prior where a people cell is unmeasured.
- Population weight: the PEOPLE-ONLY measured caller width per street and multiway fold per street and size (people's calls, people's answers, cards people showed at showdown with mucked = false; no Horse play, no HUD population rows), weight n / (n + 30).
- Own record: none exists. The opponent memory keeps no showdown record of a player's calls by size (`OMAHA_EV_CALLER_SHARE`'s own note), so no per-player record moves W or C; stated as a limit.
- No unshown cards: the data reads only cards people showed at showdown; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm MWF vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm MWF vs off; replayed 2697 of 2697

The audited sets hold almost no multiway turn or river facing-bet decisions, so the scored replay neither supports nor refutes the option.

## Known Limits

- Evidence NOT MET: the change is small (people-bet multiway turn folds 78% -> 68%) and no chip grade is significant. Grades against people as the headline (owner order) could not be run on real people: the probes use scripted seats.
- The caller width is pooled heads-up and multiway, PLO4 and PLO5; the people sample of shown calls is biased toward stronger hands (calls that later folded are never shown), so the true width is if anything wider.
- PLO5 is registered but its multiway leak was not audited here: scope the switch to PLO4 if trialled.
