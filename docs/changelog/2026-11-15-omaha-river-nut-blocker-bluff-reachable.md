# Omaha nut-blocker river bluff: why it never fired, and an opt-in that lets it reach the hands its comment names

Date: 2026-11-15. Lane: PLO Strategy. One new option, off by default (read `=== true`): `omahaRiverNutBlockerBluffReachable`.

## What happened

The Omaha nut-blocker river bluff (receipt `v86_river_nut_blocker_bluff`, shipped 2026-11-10 in the PLO overhaul) is on for PLO4/PLO5 and has had no production fire since it shipped, while the baseline river bluff fires hundreds of times a day.

## Root cause

Two conditions in `server/src/engine/HorseLogic.ts` together leave it nothing to act on.

1. It sits after the baseline river bluff, which owns the heads-up river with no showdown value (equity under 0.25) and a coherent line, and always answers with a bet or a check. With a complete action history, the baseline's "no story" result needs the opponent to have bet the turn or raised, and the nut-blocker rule refuses exactly those opponents (`capped86`). So the only hands that fall through to it are those the baseline calls showdown value: 0.25 equity or more.
2. Its made-hand gate is `cat <= 1`, which is no pair at all (`cat` 2 is one pair). A no-pair Omaha river hand does not have 0.25 equity. The rule's own comment names "air/bottom-pair at 0.18-0.28 equity"; the bottom pair is what the gate refuses.

Measured in a deterministic sweep (PLO4 and PLO5, heads-up cash, five flush-possible boards, the bare ace of the flush suit with random side cards, seven real lines, 8,400 decisions): the baseline answered 4,000 (1,118 bets, 2,882 checks); the other 4,400 all had 0.25 equity or more and all were stopped at `cat <= 1` (210 of them one pair under 0.28 equity); the rule fired 0 times.

The shipped test fires the rule only because its action history has preflop records and no flop, turn or river records, a state the live table does not send; without turn records the baseline cannot read a line.

The blocker bluff itself is not missing from play: the baseline makes it (`river_bluff_baseline_blocker`, `river_bluff_baseline_blockerAndDraw`).

## What changed

`omahaRiverNutBlockerBluffReachable: true` reads the gate as one pair or less (`cat <= 2`). Every other gate is unchanged: Omaha high, pot limit, one board, no bomb pot, heads-up, nothing to call, equity under 0.28, nut blocker held, board not paired, opponent able to respond with half a pot behind, opponent did not bet the turn or raise after the flop, ranges not against the Horse, never a station, tournament risk. With the option unset or false the brain decides exactly as before. Same sweep with the option on: 65 fires in 8,400 decisions (PLO4 29, PLO5 36), every one a pot-sized bet with one pair.

Ledger flag `omahaRiverNutBlockerBluffReachable`; league cards `plo4_omaha_river_nut_blocker_bluff_reachable` and `plo5_omaha_river_nut_blocker_bluff_reachable`; tests `HorseOmahaRiverNutBlockerBluffReachable.test.ts`.

## Limits

- The option admits any one pair under 0.28 equity, not only the bottom pair.
- It turns a hand with some showdown value into a pot-sized bet. Whether that makes money is unmeasured.
- No evaluation has been declared or run. The option stays off until one passes.

## Evaluation

Not yet declared.
