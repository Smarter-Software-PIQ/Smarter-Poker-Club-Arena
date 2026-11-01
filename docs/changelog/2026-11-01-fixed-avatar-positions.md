# Fixed table avatars in cash games and tournaments

The owner approved the equal-height tournament artwork and requested the same cash-game presentation with permanently fixed character positions. This supersedes the prior table-avatar idle/action motion direction only for the character and occupied chair; card, chip, timer, status and reaction artwork retain their existing behavior.

Table avatars now retain their resting pose through actions, folds, wins, all-ins and turn focus. Existing static bust framing and opponent normalization remain intact, while turn attention uses brightness without changing the seat size. Throwable and knockout effects cannot displace an occupied chair.

Top-seat placement retains its allocation between hands and reserves the shown-card lane before cards are revealed. Changing the action or revealing a hand no longer reanchors the character. Once the original finite allocation completes, wager collision handling cannot push an occupied chair or its neighbors to another position; only actual viewport, roster or artwork geometry changes can allocate again. Cash and tournament tables use the same artwork normalization; Hero, table, card, panel and control dimensions are unchanged.

Regression coverage checks actual avatar rectangles through turn changes in cash and tournament fixtures, alongside the occupied six- and nine-seat portrait collision matrix and fixed static geometry unit contracts. Publication and live proof are recorded in the task evidence checkpoint.

A cash-join rejection now identifies the active club wallet and explains that balances in other clubs are separate. The one-club-at-a-time funding rule and all transaction behavior are unchanged.

Compact-ring qualification exposed duplicate synchronous placement on effect initialization and spacing proposals that a completed chair lock always rejected. Revision updates now share the existing animation-frame scheduler, omit the duplicate mount/new-hand invocation, and skip only locked owner-spacing transactions. Ordinary card, wager and dealer placement remains active. A maintained hook regression fails against the former duplicate pass and verifies coalescing and single new-hand allocation. No timeout or collision assertion was relaxed.

The owner also reported already placed chips moving between actions. Contribution and all-in marker nodes now have explicit stable identities. The table placement transaction retains settled contribution anchors through later action/marker changes instead of evicting them for another collision search; new bets and table elements allocate around retained chips. Bet-entry and pot-collection animations remain in place.
