# omahaNutClassValueSize (owner ruling 2026-11-14)

Off by default (read `=== true`) since its declared evaluation (2026-11-15). It was on by the owner's order of 2026-11-15 00:32 America/Chicago and served from the owner window 1206z. The first league run could not engage it (the league's Horse state lacks stateSchemaVersion, legalActions, minRaiseTo and maxRaiseTo; eval3-20261115/AUDIT-SCHEMA-GUARD.md). The re-run with those fields supplied (PROTOCOL-nutsize-2, declared before running; source 8c63401f; 200 sessions x 300 pairs per cell; 0 illegal, 0 fallbacks) found: development human field PLO4 +2.39 bb/100 (SE 0.56), PLO5 +2.18 (SE 0.68), pooled +2.29 (SE 0.44, z +5.19); Horse-only PLO4 -1.19 (SE 0.41, z -2.91), PLO5 -1.31 (SE 0.59, z -2.22); Horses against a loose-aggressive seat PLO4 -1.29 (SE 5.62), PLO5 +8.08 (SE 5.38). The declared harm bar (no cell below -2 SE) is broken by both Horse-only cells, so it goes off as declared. Owner-text hashes cited below are prefix hashes of the append-only file (river-raise-59401453/OWNER-TEXT-SHA-PREFIXES.md).

This option is turned on by the owner's direct ruling (when a Horse holds the nuts it stops betting fractions of the pot). No value row was computed; that is stated under Value and Limits.

## Mechanism

Status: MET

The engine sizes a value bet or raise from an equity tier, board wetness and several caps (V40, the five- and six-card damp). A hand that cannot be beaten on the street was sized by the same arithmetic and often bet half the pot or less.

`omahaNutClassValueSize` in `server/src/engine/HorseOmahaMadeHandDefense.ts` runs last in the made-hand rules of the `wager_rules` node. When the decision is already a bet or a raise in PLO4 or PLO5 high and the hand is nut class for the street (the exact current nuts on the flop and turn, the river nuts, or an effective-nut hand: a full house or better no bigger full house beats, the nut flush on an unpaired board, the nut straight on an unpaired board with no possible flush), the amount becomes the pot-limit maximum, or the all-in when the stack is smaller. It never sizes down, never turns a check or a call into a wager, and leaves alone a wager that already covers every opponent who can still put chips in.

## Input fidelity

Status: MET

The rule reads the Horse's cards, the board, the legal wager bounds of the authoritative state (schema version 1, wagers not capped) and the opponents' stacks. It reads no opponent model. Its decision-level cases are built states; the nut straight cases use the boards of the reported hands with a nut holding in place of the recorded one.

## Value

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 5cc031277caf3508f48bd859c52361441823a0825aaa8d89a5e09ec89d0f7cc6

Not measured. With the nuts on the river a larger called bet wins more and a larger bet is called less often; which effect is larger depends on the callers' ranges and was not simulated. On the flop and turn a pot-sized bet with the current nuts also charges draws the most. No figure is offered. The sign is unsupported by a value row and rests on the owner's ruling.

## Continuation

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 5cc031277caf3508f48bd859c52361441823a0825aaa8d89a5e09ec89d0f7cc6

Not measured. How much less often a pot-sized bet is called than the engine's earlier size, by street and by caller, was not counted.

## Reach

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 5cc031277caf3508f48bd859c52361441823a0825aaa8d89a5e09ec89d0f7cc6

Not counted from recorded hands. In the first fix's three-day count of human-facing PLO4, PLO5 and PLO6 cash, 32 of 57 Horse river raises facing a wager were nut or effective-nut hands; how many of those were below the pot, and all bets with no wager faced, were not counted.

## Scope

Status: MET

Gated in code to all of: PLO4 or PLO5, not Hi-Lo, not fixed limit, one board, not an all-in-or-fold table, the flop, turn or river, an existing bet or raise decision, the authoritative wager bounds present, a nut-class hand, at least one opponent the current amount does not already cover. PLO6 is outside. Decision-level cases in `HorseOmahaMadeHandDefense.test.ts`: the flop, turn and river pot bets; the nut straight raising the pot; a hand that is not nut class keeping its size; a check and a call never becoming a wager. `HorseHeadsUpCommitment.test.ts` pins that a heads-up raise that already covers the opponent keeps its amount.

## Visibility

Status: MET

`omaha_nut_class_pot_wager` fires each time the size is raised (registered in `HorseDataLedger.ts`).

## Limits

Status: MET

- No value or continuation measurement. A fixed pot size with the nuts and smaller sizes with other hands makes the size informative to an observant opponent.
- The current nuts on the flop or turn can be outdrawn; the rule sizes for the street, not for the runout.
- Reach is not counted.
- Live behaviour is unverified until a release carries this and the receipt is read.

## Owner's instruction, verbatim (PLO Strategy chat, 2026-11-14, America/Chicago)

The owner's own text, exactly as typed; "[...]" marks words left out, nothing is reworded. Full record: evidence archive `plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md`.

- 19:25 (hand 59401453): "[...] THEY UNDER BET THE TURN [...] AND WHY [...] ISN'T THE HORSE POUNDING THE TURN [...]"
- 20:43: "[...] WINNING THE MINIMUM WITH VALUE HANDS BECAUSE THEY ARE BETTING FRACTIONS OF POTS, AND NOT RE RAISING BIG ENOUGH PRE TO BUILD POTS... YOU NEED TO FIX THIS NOW!!"
- 21:33 (hand 59431232): "[...] CHECKS FLOP, BETS 33% POT ON TURN [...]"

This option is ON by default on the owner's order below; his words name the misplay it answers and are not a measurement. Its value against a calling range is not measured (stated in the rows above); it changes a size only when the Horse holds the nuts or an effective-nut hand for the street.

2026-11-15 00:32 America/Chicago, after the lane told him this rule would ship switched off because it is unmeasured: "BRO MAKE IT YOURS! WHY THE FUCK WOULD YOU LEAVE THE MOST IMPRORTANT FEATURE AND THING WE NEEDED TO BE TURNED ON LEFT THE FUCK OUT!?!?!?" and "IT BETTER BE IN THIS NEXT CUT OVER!"
