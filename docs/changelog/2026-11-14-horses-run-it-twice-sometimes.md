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

`checkAllInRunout` turns every all-in hand face up (`runoutRevealActive`)
before the run-it-twice offer, so the Horse computes from exactly the cards a
person watching the screen sees. It asks once per offer, through the same
worker pool and options as the felt's `all_in_equity` (`allInEquityRequest`,
now shared by `broadcastAllInEquity`). It is not private card access. A
failure or timeout leaves the equity unknown, which runs once, and is
reported (`horse_rit_equity_failed`).

The percentages themselves are not always on the screen yet when the Horse
reads. The standalone `all_in_equity` broadcast is asynchronous and can land
after the offer. On a table where insurance can price the standing board
(insurance on, single board, before the river) it is not sent before the offer at
all: the percentages come from the insurance pass after the run-it-twice
decision, and the Horse read is the only request at that moment.

## What stays the same

The response delays (chooser 0.6 to 0.92 s, responders 1.0 to 1.6 s; an answer whose timer fires before the
equity has arrived waits at most 1.5 s more), the guards on every answer
(same hand, engine running, offer still pending, errors reported), the offer
itself, its deadlines, `RunItTwiceEngine`, insurance sequencing, and
everything a person can do. When every Horse declines the hand runs once and
the insurance branch is reachable as before. The `upgrade08_rit_chooser_*`
and `upgrade08_rit_answer_*` receipts still fire once per Horse answer, now
when the answer is decided and sent. Before, they fired when the answer was
scheduled, including answers never sent because the offer had already
resolved. Anyone reading upgrade08 run-it-twice counts should expect a step
down in the raw counts from this deploy; it is a change in what is counted,
not in traffic.

## Tests

- `HorseRunItTwice.test.ts` (new): each rule, determinism, and the rate check.
- `HorsesCanDeclineRunItTwice.test.ts`, `HorseUpgradeSideGameCounters.test.ts`,
  `Phase9FullSeatOffer.test.ts`, `Phase9FullSeatRefusal.test.ts`,
  `RunItTwice.offerpath.test.ts`: updated to the new rule. The settlement
  tests inject a 0.5 equity read and select Horses on the verdict it gives,
  because they pin offer-to-payout settlement, not agreement rates. The
  offer-path test also checks that a 95/5 all-in is not run twice.

## Follow-up after review (2026-11-14)

Review of #10794 accepted it with notes; the follow-up closes them without
changing any answer a Horse gives.

- The cutoffs are pinned at their exact edges (0.25, 0.75, 0.42, 0.58, 40 BB,
  and 0.20 / 0.80 on spots where every other rule says yes), plus
  determinism and loose bounds on the per-hand gate and the three-board
  bucket.
- Open item, not changed here: the design says three boards on 1 hand in 4
  of the eligible multi answers (table allows 3, equity 0.42 to 0.58). The
  measured share is about 1 in 5, because the three-board bucket and the
  5-in-10 gate hash the same Horse and hand and are not independent. The
  test bounds the share (0.15 to 0.30) and does not pin 0.20 as the policy.
- The failure paths are committed tests (read rejects, throws, never
  resolves, resolves late, resolves after the hand or offer ended, returns
  unknown, an answer throws).
- A failed equity read is now reported (`horse_rit_equity_failed`). The
  answer is unchanged: unknown equity runs once.
- The Horse read was not merged with the felt's equity request. On insurance
  tables there is no earlier request to share. Elsewhere a shared request
  would arrive no later than the Horse's own, so a Horse that today hits the
  1.5 s wait and runs once under load could get a number and answer
  differently. That is a decision change, which this follow-up rules out.
  The cost is one extra exact-equity worker job per run-it-twice offer that
  includes a Horse.
- Known and unchanged: if a weekly-payout pause starts in the tens of
  milliseconds between a Horse's answer timer and its equity arriving, that
  answer is dropped by the paused run-it-twice engine and the offer times
  out to a single run, the same as a person clicking during the pause. A
  responder that accepts sends no board count, so it accepts whatever count
  the chooser picks (as before).
