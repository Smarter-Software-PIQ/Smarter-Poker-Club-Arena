# 2026-11-06: Omaha Horses Raise The Current Nuts On The Flop And Turn

## What Dan Saw

Table MADNESS PLO5 1/2 + BB ANTE, hand 55690261 (03:18 to 03:20 UTC). The
horse noodle, on the button with 8c 5c Kh 3h 2d, saw a turn of As 7h 6h 4s.
The human in the big blind bet 50 into 50, three horses folded, and noodle
flat called with the small blind still to act. Noodle held the 8-high
straight, the best hand any two cards could make on that board, plus a
king-high heart redraw. The small blind called behind with a set of sixes, the
river 2s brought a third spade, and the pot went three ways for 200 instead of
being built when noodle was ahead.

## Why It Happened

The engine's decision journal shows the reference brain chose the call and
every later layer (Phase 11 PLO5 shadow, Phase 13 joint shadow, the wager
rules) kept it. The replay at that exact node, on main and on serving release
71087373, calls on all 10 seeds for every profile. The value raise in the
reference brain is an equity bar: 0.68, plus 0.05 for each extra opponent. A
sampled PLO5 equity of the nuts against two ranges came out at 0.59 to 0.66,
under the 0.73 bar, so the hand fell through to the plain pot-odds call. In
Omaha the current nuts are often under 70 percent against two players even
though nobody can beat them yet, so a bar written for Hold'em made hands
turned the strongest hand at the table into a flat. The rule that forces the
nuts to raise (riverNutsRaise) only ran on the river.

## The Fix

`server/src/engine/HorseOmahaCurrentNuts.ts`, run with the final wager rules
right after the river nuts rule. In PLO4, PLO5 and PLO6 (high only, one
board), on the flop or turn, facing a bet the horse can raise, a call becomes
a pot raise (the controller maximum; all in when the pot raise is the whole
stack) when the horse holds the exact current nuts and either:

- has a redraw: at least four unseen next cards lift it to a better hand
  category (the freeroll), or
- holds a hand nobody else can tie (a vulnerable nut hand: raise to protect).

It keeps the call in two documented cases: a chop-locked nut hand (another
two cards make the same hand) with no redraw, and a bet whose V23 plan already
said "if raised, call once". The nuts are worked out exactly from the horse's
own cards and the board (every unseen pair checked), never from anyone's
hidden cards, and the rule never looks at whether an opponent is a horse or a
person.

The complaint replay now stamps the same state version the live engine sends
(`stateSchemaVersion: 1`), so replays run the final wager rules exactly as
production does.

## How Often It Happened

Last 24 hours (2026-11-05 03:30 to 2026-11-06 03:30 UTC), horse PLO4/5/6 flop
and turn decisions facing a bet while holding the exact current nuts: 1,156
calls and 3,941 raises or all ins. With a player still to act behind: 350
calls against 150 raises. Nuts with a redraw and a player behind: 194 calls
against 49 raises. The new rule would have turned up to 676 of the 1,156
calls into raises (596 with a redraw, 80 unique nut hands; a call answering
its own callOnce plan stays a call); the 480 chop-locked calls with no redraw
stay calls. "Raises" here include every all in, so a few short all-in calls
are counted on the raise side.

## Tests

- `server/src/engine/horseComplaints/plo5-turn-nut-straight-with-flush-redraw-flats-multiway.law.test.ts`:
  the real hand, clock pinned to the live decision time; no profile or seed
  calls, and with the rule switched off the call comes back.
- `server/src/engine/HorseOmahaCurrentNuts.test.ts`: nuts with a redraw
  multiway, heads-up and on the flop raise; a pot raise that is the whole
  stack goes all in; the unique nut flush with no redraw raises; a
  chop-locked nut straight with no redraw calls; a hand that is not the nuts,
  the river, hi-lo and existing raises are untouched.
