# omahaNoCallColdFourBetWithoutPremium (owner complaint 2026-11-15, hand 59518335; branch agent/plo-underpair-01BbZPDi/fix/omaha-no-stack-off-with-underpair, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Production hand 59518335 (PLO5 1/2 cash, big blind ante, a 50% VPIP floor table): the button re-raised an open and two calls to 50 with a pair of queens and three low cards, the big blind re-raised cold to 180, the opener called, and the button called 130 more with 220 left behind a pot of 561. Traced at source, the call is `HorsePreflop.ts`, the branch `v86_plo_three_bettor_continues` (a re-raiser that is re-raised continues at pot odds of 0.45 or better with strength of 0.56 times the style tightness; here strength 0.63 at a price of 0.23). With the Horse's own judged VPIP well under the floor the same node shoves instead (the jam bar is a product of the floored tightness, and the PLO6-AUDIT-004 protection applies only when the call is at most 30% of the stack; here it is 37%).

The option (`omahaColdFourBetFold` in `HorseLogic.ts`, cell `omahaColdFourBetCell` in `server/src/engine/HorseOmahaUnderpair.ts`) runs outermost on both decision paths. When the Horse's own preflop re-raise was re-raised by a player whose raise is his first voluntary money of the hand (`omahaColdFourBetFaced`: three or more raises, the last one cold, the one before it the Horse's), a continue with a hand that holds no pair of aces and no premium structure (`omahaReraisedPremium`, the re-raised-pot discipline's own definition) folds, unless the call is all in or leaves no more behind than the call itself AND its equity against a random hand holding a pair of aces pays the direct price (`omahaReraisedPreflopCell`, unchanged). A measured maniac re-raiser keeps today's play, as in `omahaReraisedPotFold`.

How it differs from `omahaReraisedPotDiscipline`'s preflop cell, whose evaluation failed against a light 4-bettor: that cell answers every 4-bet, the opener's included, and keeps any call that leaves less than a pot behind when it pays against aces (it keeps the recorded call: 220 behind a 561 pot, 39% against aces at a price of 23%). This option answers only a cold re-raise of the Horse's own re-raise, and keeps a call only when no real decision is left behind it. `omahaReraisedFoldVsTight` needs a measured read of the 4-bettor; this needs none.

## Input fidelity

Status: MET

Public action history and the Horse's own cards only. The recorded decision is replayed from the public snapshot the engine stored with it (`HorseOmahaUnderpair.fixture.json`, anonymised to seats); the Horse's own judged VPIP is not in a snapshot, so the replay is run both without it and at the floor.

## Value

Status: NOT MET

Not measured. On the recorded hand the engine's own model prices the call (39% against a random aces hand heads-up, 29% three-way against aces and a random hand, for a direct price of 23% and about 28-35% for the whole stack), so the fold is not shown to gain; the declared paired evaluation decides (league cards `plo4_omaha_no_call_cold_four_bet`, `plo5_omaha_no_call_cold_four_bet`).

## Continuation

Status: NOT MET

Not measured separately. A preflop fold ends the hand.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the fold receipt count per evaluation cell; a cold re-raise of a Horse's own re-raise is rare.

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only, preflop, fold legal. Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside. `HorseOmahaUnderpair.test.ts`: unset, false and a truthy non-boolean decide byte-identically; on, the recorded continue folds at every seed (with and without the Horse's own VPIP) and draws nothing from the random stream; aces, kings double-suited and a double-suited rundown, the opener's own 4-bet, a call that is the stack (priced against aces) and Hi-Lo keep today's decision; PLO4 gets the rule; the fold is admitted by the worker receipt validator.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_no_call_cold_four_bet_without_premium` (folded) and `omaha_no_call_cold_four_bet_without_premium_priced_in` (kept on the committed price).

## Limits

Status: MET

- The trace does not show this call to be a losing one on its price; the recorded hand's first cause is the re-raise itself (see the changelog: the VPIP floor lowers the 3-bet bar).
- "Cold" is read from this hand's actions only; a player who limped or called and then re-raises is not cold.
- The declared range (aces) is the re-raised-pot cell's model, unchanged.
- Live behaviour is unverified: the option is off.
