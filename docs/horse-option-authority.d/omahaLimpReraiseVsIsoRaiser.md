# omahaLimpReraiseVsIsoRaiser: authority for the live switch

Built 2026-11-27 by lead-8 lane limprr on the owner's order of 12:48 PM Chicago. **Evidence MET on the harness bars B1 to B7** (lead-9 ruling, 2026-11-27). Audited / real-node replay: nothing to judge (0 of 3,566 audited decisions and 0 of 1,247 real limp-then-raised nodes change, because today's Horses never limp a top-20% hand); this leg is owed from live watch-only reads against people before the option is switched on. The option stays OFF. Default off (read `=== true`), switchable live, PLO4/PLO5 cash only (table and Lightning), preflop only. This file does not authorize switching it on.

## The owner's rulings it follows

- 2026-11-27 12:48 PM: "Incorporate some limp re-raises in position when you know you have a [player] that will always raise when the Horse has a strong hand, but this should always be in position or with a connected rundown hand." Both steps act only in position against the raiser after the flop, or with a connected rundown.
- 2026-11-17 (VPIP floor): a floor limp limps for one big blind and folds to a raise, nothing else. Untouched: every floor step runs before this option, and a limp the floor made (`ownVpipFloorLimpThisHand`) is never re-raised.
- No rule keyed on person-versus-Horse identity or a named player: the raiser is read from his own public record, one formula for every opponent.
- No blanket rules: the limp and the re-raise are each priced on this hand, his record, the pot and the stacks.
- 2026-11-26 12:21: statistics from people only. The priors are people-only.

## What was measured (public actions, people only)

PLO4/PLO5 cash hands with a person, 2026-11-19 23:00Z to 11-27 05:00Z (lane l8-preflop): people isolate a limp 65.5% of the time in PLO5 (1,137; per person 73%, 74%, 87%, 23%, 15%) and 36.7% in PLO4 (90); people fold to a 3-bet 0 of 786 (PLO5) and 1 of 47 (PLO4). Lane OFD: a zero-equity isolation raise over a Horse limp, every limper folding as the floor ruling now makes them, wins +0.42 +/- 0.18 bb (PLO5 era A, n 734) and +1.26 +/- 0.36 (era B, n 175).

## What it does

See `server/src/engine/HorseOmahaLimpReraise.ts`. (1) First in, at most two players behind, a strong hand (top 20% by `omahaPreflopPercentile`, not trips or trash) the brain raises: J = the player behind with the highest shrunk raise-when-unraised rate; only in position against J or with a connected rundown (four distinct ranks in a five-rank window, nine-high or better; any four of five in PLO5): EV(limp) = r EV(pot 3-bet of his pot isolation) + (1 - r) EV(limped pot) against EV(open); the limp is made with probability 0.5 (deterministic on the Horse's own cards, seat and dealer) when EV(limp) clears EV(open) by 1% of the pot plus the sampling error. (2) The Horse's own limp, raised once, heads-up against the raiser, strong hand, in position or rundown: the pot re-raise when EV(re-raise) > max(EV(call), 0) + deadband + sampling error. Realization: `reraisedPotRealization` (the self-play fit of `omahaReraisedPotCallIsPriced`). Equity: 360 samples against his range (the top 0.9 r of holdings) and against one random holding.

## Prior anchor

- Baseline: the people-only rates: a raise-when-unraised (isolation) rate of 0.54 in PLO5 (the person mean) and 0.367 in PLO4 (pooled, thin), and a fold to a re-raise of 0.01 (people folded 1 of 833 3-bets). No equilibrium anchor is needed: neither cell is thin.
- Population weight: 5 pseudo-chances for the raise rate, 3.4 for the fold. Small on purpose: people differ by a factor of five.
- Own record: his decayed exploit counters (`HorseMind.currentExploitCounters` rfi / rfiOpp: his raise at his first action into an unraised pot, an isolation over a limp included; foldTo3Bet / foldTo3BetOpp). The engine keeps no pure isolation counter; rfi equals the isolation rate for PLO5 people (open 63.9% vs isolation 65.5%) and under-reads a PLO4 isolator (open 23.6% vs 36.7%), so it errs toward fewer limps.
- No unshown cards: the priors are counts of public actions; the price reads the deciding Horse's own cards and the public table state.

## Grades

Grade sheet of 2026-11-27 23:05Z (grader W13b for lead-9; bars in S7/l8-limprr/BUILD.md, written before any grade).

Every figure is ON-minus-same-seed-no-op, bb/100 of the Horses' net, on the fixed harness (#12212), base = live switch rows
(S7/l8-harness/opts-live.json), 100 bb stacks. Every run: no-op 0.00 with 0 divergent deals, 0 illegal, 0 truncated.
Pooled = inverse-variance over the seeds listed. Bars are the ones written in BUILD.md at 19:20Z (unchanged).

| Card                                                                | Game                      | Seeds (size each)                     | ON-minus-no-op bb/100 ± SE                             | Bar                             | Result          |
| ------------------------------------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------- | --------------- |
| B1 probe: raises pot over every limp                                | PLO5 HU                   | 401, 402 (6,000 deals)                | +2.77 ± 1.35 (+4.17 ± 1.93; +1.45 ± 1.88)              | > 0                             | PASS            |
| B1 probe: raises pot over every limp                                | PLO4 HU                   | 401, 402 (6,000 deals)                | +1.06 ± 0.64 (+1.43 ± 1.47; +0.97 ± 0.71)              | > 0                             | PASS            |
| B1 second clause: the raiser's own net vs ON Horses                 | PLO5 HU / PLO4 HU         | 401, 402                              | +2.2 ± 8.3 / +1.2 ± 7.9                                | not > 0 by 2 SE                 | PASS            |
| B1 probe: raises pot over every limp (NEW)                          | PLO5 6-max                | 401 (3,000 deals)                     | +1.40 ± 0.69 (7 divergent deals)                       | > 0                             | PASS            |
| B2 probe: tight raiser, top 10% only                                | PLO5 HU                   | 401, 402 (6,000 deals)                | -0.66 ± 0.96 (-0.14 ± 1.07; -2.72 ± 2.12)              | not below -2 SE                 | PASS (-0.7 SE)  |
| B2 probe: tight raiser, top 10% only                                | PLO4 HU                   | 401 (6,000 deals)                     | -1.24 ± 0.75                                           | not below -2 SE                 | PASS (-1.65 SE) |
| B2 probe: tight raiser, top 10% only (NEW)                          | PLO5 6-max                | 401 (3,000 deals)                     | +0.10 ± 0.27 (3 divergent deals)                       | not below -2 SE                 | PASS            |
| B3 people-calibrated responder                                      | PLO5 HU                   | 401, 402 (6,000 deals)                | -0.53 ± 0.75 (-0.31 ± 0.81; -1.76 ± 1.91)              | not below -1 SE                 | PASS (-0.7 SE)  |
| B3 people-calibrated responder (NEW)                                | PLO4 HU                   | 401 (6,000 deals)                     | -0.50 ± 0.65 (15 divergent deals)                      | not below -1 SE                 | PASS (-0.77 SE) |
| B3 people-calibrated responder (NEW)                                | PLO5 6-max                | 401 (3,000 deals)                     | +0.62 ± 0.58 (4 divergent deals)                       | not below -1 SE                 | PASS            |
| B4 mirror, ON seats vs OFF seats (NEW)                              | PLO5 HU                   | 501, 502 (6,000 pairs = 12,000 hands) | -1.71 ± 2.93 (-4.12 ± 4.26; +0.44 ± 4.03)              | not below -2 SE                 | PASS (-0.6 SE)  |
| B4 mirror (NEW)                                                     | PLO4 HU                   | 501 (6,000 pairs = 12,000 hands)      | +2.22 ± 2.84                                           | not below -2 SE                 | PASS            |
| B4 mirror (NEW)                                                     | PLO5 6-max                | 501, 502 (3,000 pairs = 6,000 hands)  | -0.85 ± 1.00 (-0.45 ± 1.39; -1.28 ± 1.45)              | not below -2 SE                 | PASS (-0.8 SE)  |
| B5 flag-off                                                         | all                       | 28,000 decisions                      | 0 differences                                          | 0                               | PASS            |
| B6 cost                                                             | PLO4/PLO5, 100/300/800 bb | 2,520 spots                           | p95 1.45 ms, max 2.30 ms, 0 over 25 ms; law ratio 0.65 | p95 <= 10, max <= 25, none > 50 | PASS            |
| B7 law (IP or rundown; floor limp never re-raises; off = identical) | PLO4/PLO5                 | law suite                             | 12/12 pass                                             | pass                            | PASS            |

Harness verdict (grader W13b): MET on every bar written in BUILD.md (B1 to B7, all games listed); no card failed. Caveat the lead must weigh before the authority doc says MET: the audited-decision replay found nothing to judge (0 changed, 0 fixed, 0 newly wrong in 869 + 2,697 audited decisions and in 1,247 real limp-then-raised nodes), so the proof is harness chips only, none from real hands.

Limits, stated plainly:

- No measured gain against people: the people responder reads -0.53 (PLO5 HU), -0.50 (PLO4 HU), +0.62 (PLO5 6-max), all inside 1.1 SE of zero. The only significant gain is against the scripted any-two isolator.
- The mirrors are also inside 1 SE of zero (PLO5 HU -1.71, PLO5 6-max -0.85, PLO4 HU +2.22): no loss shown, no gain shown.
- 6-max probes are thin: the option changed 7, 3 and 4 deals of 3,000. One seed each.
- Single seed: PLO4 tight, PLO4 people, PLO4 mirror, all three 6-max probes.
- Earlier rows (seeds 401/402 HU probes) were graded on commit 9298a1155123 + harness a3f35178; the NEW rows on branch head 7ea860ee3d3a + origin/main fd425990 (grade-only worktree S7/wt-l9-limprr-grade, local merge 4bedcda92eb1, never pushed). W13 logged that the later fixes do not change decisions; not re-verified here.
- Mirrors and people probes ran through server/scripts/horse-grade.ts; the iso and tight probes need the lane's scripted raiser, so they ran through the lane's own limp-grade script, which is not in the repo (same harness calls).
- The harness has no VPIP floor; rfi is the stand-in for an isolation counter.

Not run: PLO4 6-max (no bar asks for it); second seeds for the single-seed cards; batch1's extra "iso plo4 seed 403". No card was re-run.
Raw: S7/l8-limprr/out/g1.jsonl (earlier), S7/l8-limprr/l9/qa.jsonl and qb.jsonl (new); table reader python3 S7/l8-limprr/l9/ana.py.

## Tests

`server/src/engine/anOmahaLimpReraiseVsIsoRaiser.law.test.ts` (11 tests): every limp is a strong first-in raise turned into the limp of the price, out of position only rundowns; every re-raise is the Horse's own limp raised heads-up, out of position only rundowns; a floor limp is never re-raised; multiway, 4-bet pots and tournaments are outside it; off byte-identical; people prior; relative cost against the sibling re-raised-pot price.

## Evidence rows

- Mechanism, scope, receipts, tests, off-identity: MET.
- Chips: MET on the harness bars B1 to B7 (see Grades; several cards single-seed; no measured gain against the people responder; the harness has no VPIP floor).
- Audited decisions: nothing to judge (0 changed of 869 + 2,697; rows under Replay). Real limp-then-raised nodes: 0 of 1,247 change.
- Against people: NOT MEASURED (only live watch-only reads can show it; owed before the option is switched on).

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm LR vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm LR vs off; replayed 2697 of 2697

Both sets: no decision changed, so nothing was fixed and nothing made newly wrong (today's Horses never limp a top-20% hand). Rows as recorded by the lane (S7/l8-limprr/aud/rows.lr.txt).

## Rollback

Switch row off (about 30 seconds); the option reads `=== true` and does nothing otherwise.
