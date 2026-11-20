# omahaReraisedPositionInLightning: authority for the live switch

Lightning parity lane, 2026-11-18. Evidence: mechanism, scope, tests and off-identity MET; value on Lightning hands NOT MEASURED (evaluation declared, not run).

## The owner's order it rests on (verbatim)

- 2026-11-18 10:51 America/Chicago: "woowoo is currently playing lightning games plo5 1/2 these same features and functions need to be activated inside for those games as well for the horses if it hasn't already?"

## What it does

#11287 (finding F-02 and the realization measurement of 2026-11-18) priced a PLO4/PLO5 cash call of a re-raise with position by seat order (in position = acts after the re-raiser, nothing else), the players who called the price read by their bands or charged as dilution, and no charge for a raiser or a caller still to act. It left Lightning on the reading it had (`omahaReraisedLaneUntouched`, `server/src/engine/HorseLogic.ts`): in position only after every player in for the price, and 0.35 on heads-up equity for each player in for the price and each raiser of the hand still to act.

With this option on, a Lightning PLO4/PLO5 cash call of a re-raise is priced exactly as the same hand at a table (`omahaReraisedCallPricingOf`; pinned by test: the pricing of a pool hand with the option on equals the pricing of the same hand at a table). Off, Lightning keeps its reading. Tournaments are unchanged. The priced call itself (#11247) already runs in Lightning and still only turns a class fold into a call; it never creates a fold.

## Why Lightning can take the table reading

A pool hand has real seats and a button for the hand, so the seat order is the hand's own. The one difference is the fast fold: a seat still to act may already have left, which the snapshot does not show. The table reading already gives a seat still to act no charge and no position in the price, so it does not depend on whether that seat is still there; the old reading charged 0.35 for a raiser still to act whether or not he had left.

How often the two readings differ: in the PLO5 1/2 pool on 2026-11-18 (11:46Z to 17:00Z, 566 hands with two or more preflop raises), 817 of 1,506 Horse decisions facing a re-raise had a raiser of the hand still to act (recorded: 802 folds, 4 calls, 11 raises); none differed in position alone.

## What is not known

The measurements behind the table reading (12,473 calls of a 3-bet or 4-bet, 2026-10-15 to 2026-11-17: charge per other player -0.03, SE 0.06; raiser still to act -0.09, SE 0.09) are Classic-table hands. None is a pool hand. Fast-fold pools change who continues. The four recorded Lightning Horse hands in the tests stay folds with the option on; of 200 seeded hands on the five recorded lines one fold becomes a call.

## Receipts

The existing `omaha_reraised_call_priced_call`, `_priced_fold` and their `_after_own_raise` forms. No new receipt: the option changes the inputs of the priced call, not its path. The switch receipt `option_switch_omahaReraisedPositionInLightning_on_seen` shows the workers read it.

## Tests

`server/src/engine/HorseOmahaReraisedPositionInLightning.test.ts`.

## Evidence rows

- Mechanism, scope, tests: MET. Off (absent, false, non-boolean): identical decisions and draws (test); recorded decisions replay identically against main (lane report).
- Value against opponents' actual hands on Lightning hands: NOT MEASURED. Declared: audit archive `repairs/LIGHTNING/EVAL-DECLARATION-omahaReraisedPositionInLightning.md`.

## What the activation row must contain

`option = 'omahaReraisedPositionInLightning'`, `state = 'on'`, note `authority: omahaReraisedPositionInLightning docs/horse-option-authority.d/omahaReraisedPositionInLightning.md sha256 <the sha256 of this file as merged>`, only after its declared evaluation passes, the serving engine build knows the option name and the switch-list migration that adds it is installed.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
