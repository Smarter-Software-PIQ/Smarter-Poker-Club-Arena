# omahaLimpReraiseVsIsoRaiser: authority for the live switch

Built 2026-11-27 by lead-8 lane limprr on the owner's order of 12:48 PM Chicago. **Evidence NOT MET**: the option stays OFF until its grades below are read and the lead decides. Default off (read `=== true`), switchable live, PLO4/PLO5 cash only (table and Lightning), preflop only. This file does not authorize switching it on.

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

PENDING (bars in S7/l8-limprr/BUILD.md, written before any grade).

## Tests

`server/src/engine/anOmahaLimpReraiseVsIsoRaiser.law.test.ts` (11 tests): every limp is a strong first-in raise turned into the limp of the price, out of position only rundowns; every re-raise is the Horse's own limp raised heads-up, out of position only rundowns; a floor limp is never re-raised; multiway, 4-bet pots and tournaments are outside it; off byte-identical; people prior; relative cost against the sibling re-raised-pot price.

## Evidence rows

- Mechanism, scope, receipts, tests, off-identity: MET.
- Chips: see Grades.
- Audited decisions: NOT RUN.
- Against people: NOT MEASURED (only a live shadow can show it).

## Replay

- Replay: NOT RUN (as of 2026-11-27 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

Switch row off (about 30 seconds); the option reads `=== true` and does nothing otherwise.
