# Fixed table avatars in cash games and tournaments

The owner approved the equal-height tournament artwork and requested the same cash-game presentation with permanently fixed character positions. This supersedes the prior table-avatar idle/action motion direction only for the character and occupied chair; card, chip, timer, status and reaction artwork retain their existing behavior.

Table avatars now retain their resting pose through actions, folds, wins, all-ins and turn focus. Existing static bust framing and opponent normalization remain intact, while turn attention uses brightness without changing the seat size. Throwable and knockout effects cannot displace an occupied chair.

Top-seat placement retains its allocation between hands and reserves the shown-card lane before cards are revealed. Changing the action or revealing a hand no longer reanchors the character. Once the original finite allocation completes, wager collision handling cannot push an occupied chair or its neighbors to another position; only actual viewport, roster or artwork geometry changes can allocate again. Cash and tournament tables use the same artwork normalization; Hero, table, card, panel and control dimensions are unchanged.

Regression coverage checks actual avatar rectangles through turn changes in cash and tournament fixtures, alongside the occupied six- and nine-seat portrait collision matrix and fixed static geometry unit contracts. Publication and live proof are recorded in the task evidence checkpoint.

A cash-join rejection now identifies the active club wallet and explains that balances in other clubs are separate. The one-club-at-a-time funding rule and all transaction behavior are unchanged.
