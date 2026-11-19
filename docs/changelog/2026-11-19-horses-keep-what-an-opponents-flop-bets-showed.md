# Horses Keep What An Opponent's Flop Bets Showed, And What Calling Them Returned (Measurement Only)

2026-11-19. Horse decisions lane. No decision changes: nothing reads the new records.

## Why

The flop facing-bet verdict (`omahaFlopFacingBetEv`, default off) prices a call against the bettor's range. A read of how often an opponent bets a flop was built and measured on the 563 audited decisions: it fixed 1 and newly broke 4. The audit's finding was that the verdict lacks two things about the bettor: what he holds when he bets the flop, and what calls of his flop bets actually returned by the caller's hand class and position. Neither was kept anywhere durable.

Separately, the sampled-raise comparison needs each fold-to-raise cell to say at what price it was measured. A cell kept only how often he folded.

## What Is Kept

Migration `20261119192551` (daily-maintenance window, one transaction, additive, forward only, no back-fill) adds two nullable columns to `horse_exact_profiles`, written by the accepted-hand learner that already keeps the profile's counters.

`flop_shown`: two flat lists of integers.

- `bet` (40): when he made the first bet of a flop and his hand was shown at the showdown, the class of that hand on the flop (nut class, strong made, weak made, strong draw, air), by his line (continuation bet or any other first bet) and by flop texture (paired, rainbow, two-tone, monotone).
- `call` (40): for each player who called that bet before any raise, what the call cost and what the hand returned to the caller from the call on, by who called (a Horse or a person) and by the caller's class and position (made, draw in position, draw out of position, one pair or less). A caller whose hand was never shown is counted in an `unshown` cell.

`street_counters_price`: per street, the sum of the prices of the raises he faced after betting or raising, and how many had a price. The mean price of a fold-to-raise cell is `sum / opp`. It is a separate record, so `street_counters`, its validation and its wire row are untouched.

## Public Information Only

A hand is read only when the hand's public record shows it: `hand_history.hole_cards` (written from the showdown's revealed holdings only) names the player and `hand_history.showdown` lists him as not mucked. A folded or mucked hand is never read. Money is replayed from the public action log, the winners list and the pot size.

## Known Limit

The class cells see only hands that reached a showdown and were tabled. A caller who called the flop and folded later is in `unshown`, never in a class cell, so the class cells lean toward calls that continued. The `unshown` cell is kept so a consumer can see how much of the money the class cells miss.

## Storage

Every number in `flop_shown` is an integer and a count never exceeds 50 000, so the record does not grow with play. A full record is under 700 characters as text; both records add under 900 characters to a decision read frame per opponent that has them, and nothing to a frame with none (it keeps its exact earlier bytes). Hold'em rows learn no flop class and Hold'em decisions carry neither record.

## Delivery

The records travel on the pooled public row into an Omaha decision's own state and its read frame (`horse-decision-reads-v20`). `HorseMind.omahaFlopShownOf` and `HorseMind.omahaFoldToRaisePriceOf` answer them. No decision calls either.

## Proof

- `HorseOmahaFlopShown.test.ts`: the hand category equals the evaluator's on 6 000 dealt hands; the caller class equals the flop verdict's own on 6 000 dealt hands.
- `HorseOmahaFlopShownChangesNoDecision.test.ts`: the recorded flop, turn and river decisions are byte-identical with the columns empty or full, with the release options and with every opponent-reading Omaha option on.
- `aFlopShownRecordThroughTheWorker.test.ts`: FAST, DEEP and the exact replay agree.
- `whatAFlopBetShowedIsKeptAndDelivered.law.test.ts`: delivery, unknown stays unknown, source scan that nothing reads the records, public-only.
- `scripts/ci/test-horse-exact-public-memory.py`: the SQL reducers equal the engine's on `scripts/ci/fixtures/horse-flop-shown-vectors.json` in a disposable PostgreSQL 17.
