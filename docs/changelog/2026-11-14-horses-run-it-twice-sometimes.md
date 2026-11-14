# Horses run it twice only sometimes, and never when the all-in is lopsided

Date: 2026-11-14 (owner ruling 2026-11-13 23:37 Chicago)

## What

A Horse's answer to a run-it-twice offer now depends on its own all-in
equity. Before this change the answer was a hash of the Horse's id and the
hand number that said "run it more than once" about seven hands in ten,
whatever the cards were: a Horse chooser picked 2 boards (3 on every third
hand) and a Horse responder accepted.

## Why

Dan, 2026-11-13: "Why are Horses always agreeing to run it twice or 3 times.
A Horse with bottom set should not be agreeing to run it 3 times with one
out. Horses should only be running it multiple times SOMETIMES, not all the
time."

## The rule

`horseRunItTwiceRuns` in `server/src/engine/HorseRunItTwice.ts`, in order:

1. Equity unknown (not yet public, or the worker pool did not answer): run
   once. A Horse never agrees blind.
2. Equity at or below 0.25, or at or above 0.75: run once. This is the
   bottom-set-with-one-out case and its mirror, the big favourite.
3. `prefersRunItTwice` (the Horse's stable persona preference, a pot of at
   least 40 BB, closeness of the spot) says no: run once.
4. A deterministic per-(Horse, hand) gate says yes on 5 hands in 10.
5. Otherwise 2 boards; 3 only when the table allows 3, the equity is between
   0.42 and 0.58, and a second deterministic bucket (1 hand in 4) says so.

Never more than the table's maximum. No `Math.random` and no engine random
stream, so a replay of a hand answers the same way. A chooser Horse picks the
board count this gives; a responder Horse accepts only if the rule gives 2 or
3 for its own equity, and declines otherwise.

Measured on 3,000 synthetic (Horse, hand) spots at a coin flip in a 100 BB
pot, about 25 percent of answers are "more than once"; at equity 0.10 or
0.90, and in pots under 40 BB, none are.

## The equity is public at the offer

`checkAllInRunout` turns every all-in hand face up (`runoutRevealActive`) and
broadcasts `all_in_equity` before the run-it-twice offer. The Horse reads the
same number a person watching the screen reads, requested once per offer
through the same worker pool and options (`allInEquityRequest`, now shared by
`broadcastAllInEquity`). It is not private card access. A failure or timeout
leaves the equity unknown, which runs once.

## What stays the same

The response delays (0.6 to 1.8 s; an answer whose timer fires before the
equity has arrived waits at most 1.5 s more), the guards on every answer
(same hand, engine running, offer still pending, errors reported), the offer
itself, its deadlines, `RunItTwiceEngine`, insurance sequencing, and
everything a person can do. When every Horse declines the hand runs once and
the insurance branch is reachable as before. The `upgrade08_rit_chooser_*`
and `upgrade08_rit_answer_*` receipts still fire once per Horse answer, now
when the answer is decided.

## Tests

- `HorseRunItTwice.test.ts` (new): each rule, determinism, and the rate check.
- `HorsesCanDeclineRunItTwice.test.ts`, `HorseUpgradeSideGameCounters.test.ts`,
  `Phase9FullSeatOffer.test.ts`, `Phase9FullSeatRefusal.test.ts`,
  `RunItTwice.offerpath.test.ts`: updated to the new rule. The settlement
  tests inject a 0.5 equity read and select Horses on the verdict it gives,
  because they pin offer-to-payout settlement, not agreement rates. The
  offer-path test also checks that a 95/5 all-in is not run twice.
