# The Hold'em Persona Reaches Preflop Ranges (Default Off)

Owner order 2026-11-15 08:05 Chicago: build, fix and enhance the missing Hold'em persona promises, fully wired in and tested. This is one option, `holdemPersonaPreflop`, OFF by default. Nothing changes in play until it is turned on, and turning it on is a separate owner decision: its range-width part is a preflop range change, and the owner's preflop range hold stands (decision packet `PACKET-PERSONA-PREFLOP-20261115.md` in the Hold'em lane's evidence folder).

## What Was Missing

Every Horse has a Hold'em archetype worked out from its id (LAG Shark 25 percent, Tricky Trap 20, TAG Crusher 40, Nit Hunter 15). The plan (lines 85 and 152) promised that the archetypes play visibly different preflop: nine-seat cash VPIP of about 29-31 (LAG), 27-29 (Tricky), 26-28 (TAG) and 25-27 (Nit Hunter), and 3-bets "seeded deterministically per hand + persona". Measured before this change, every archetype played the same ranges (28.2 to 28.8 VPIP, one population). The Nit Hunter's description ("punishes loose openers / limpers") had no rule behind it.

## What Changed

With `holdemPersonaPreflop` on, two-card no-limit hold'em only:

1. **3-bets and squeezes per hand + persona.** The option turns on the persona re-raise mix built in PR #10791 (`holdemPersonaReRaiseMix`): the 3-bet bluff and the squeeze bluff decide on the Horse's own number for the hand (Horse id, table id and hand number, exact hole cards), scaled by its archetype's mix, and never more often against a player the style read holds tight. Value 3-bets are a strength bar and are not touched. Shallow four-bet reshoves are not persona-specific (owner decision R3-B).
2. **Per-archetype range width.** On V85 cash tables deeper than 50 big blinds, the seat's opening share (the share of hands it opens, including isolating one or two limpers) and the defender's continue share facing one open move by fixed points: LAG Shark +4 open / +1.5 continue, Tricky Trap 0 / 0, TAG Crusher -1 / -2, Nit Hunter -3 / -3. The points taper with stack depth (none at 50bb or less, full from 85bb). Only hands near each seat's existing bar move; no pair, premium or value 3-bet hand moves.
3. **The Nit Hunter punishes loose players (preflop half).** Against an opener the existing opponent read holds credibly wide, or behind a limper it holds credibly loose (never a presumed read), a Nit Hunter stops tightening: +2 open points (it isolates wider than the fleet) and 0 continue points. The postflop half of its description ("stabs capped checked ranges") is not built here.

## What Is Protected

- **The Hybrid protection.** Calibrated opening widths are never multiplied by a per-Horse tightness (`nlhOpeningTightness` stays 1 under `referenceNlhOpenings`). The persona moves the target share before it becomes a bar; it never reads or writes a tightness multiplier, a value bar or a bluff probability.
- **The VPIP floor.** On a table with a Classic VPIP floor no shift narrows a range (`holdem_persona_floor_held_seen`), so a TAG or Nit Hunter is never pushed toward the floor by the persona.
- **Everything else.** Tournaments get no range shift (they still get the re-raise mix). Omaha, short deck, pot limit, fixed limit, hi-lo and All-In-Or-Fold get nothing. No random draw is added, removed or moved. Nothing reads a realised frequency or steers toward a band.

## Counters

`holdem_persona_open_shift_seen`, `holdem_persona_continue_shift_seen`, `holdem_persona_floor_held_seen`, `holdem_persona_nit_punish_seen`, and the eight re-raise mix counters of #10791.

## Proof

- `server/src/engine/HorseHoldemPersonaPreflop.test.ts`: the module's numbers (shifts, bands, depth taper, floor and punish rules); through the real brain, a nine-handed UTG seat over 459 sampled holdings: a LAG opens more, a TAG and a Nit Hunter fewer, a Tricky Trap decides every holding exactly as off; at 40bb, in a tournament and with the option false every archetype decides every holding exactly as off; on a VPIP-floor table a Nit Hunter decides exactly as off while a LAG still widens; the big blind facing an open: a LAG continues more, a Nit fewer; a Nit Hunter facing a maniac's open punishes and does not continue less than off; behind a maniac or calling-station limper it isolates more than off, and with no read fewer. These fail before the change (the option did not exist).
- `server/src/benchmark/HoldemPersonaReplayVsMain.test.ts`: 5,800 fixed-seed full hands of hold'em and Omaha against a recording from main: option absent and `holdemPersonaPreflop: false` equal main on every hand and decision; option on, every Omaha hand equals main, the 30bb cash and the tournament cells differ only where a persona re-raise comparison changed an answer (exactly the hands the re-raise mix alone changes: no range shift there), and the 100bb cells differ only in hands where a persona bar moved or a comparison changed.
- Ledger flag and counters; league card `cash9_holdem_persona_preflop` (not yet run).

## Measuring It

`server/src/benchmark/HoldemPersonaPreflopProbe.ts` (command line `server/scripts/holdem-persona-preflop-probe.ts`): 900 synthetic ids in exactly the 25/20/40/15 mix, 100 nine-handed tables, every seat rotation, 700 hands each: 630,000 hands per arm, option off and on on the same deals. Per archetype: VPIP and PFR per hand dealt, RFI per unopened spot, cold call and 3-bet per single-raise spot, with intervals. The results of the declared run are added below in a separate commit.

## Limits

- Synthetic ids, Horses against Horses, preflop only. Nothing here measures profit or how people respond.
- The probe decides with opponent memory off, so the Nit Hunter's punish rule never engages in it; it is proven by the fixed-input tests only.
- The band targets are nine-seat cash at 100bb. At 250bb the fleet already plays about 1.3 points wider (requirement map), so the archetypes are expected above their bands there; six-seat play is not banded per archetype by the plan.
- This is a preflop range change. Merging it off does not lift the range hold.
