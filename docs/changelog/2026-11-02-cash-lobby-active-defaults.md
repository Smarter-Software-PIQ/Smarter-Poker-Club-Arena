# Cash Lobby Active Defaults

Cash browsing now hides empty games until the player explicitly selects Show Empty Tables. This one lobby-wide choice applies to All and every cash variant, alongside seat, stake, favorite and advanced filters. Closed, deleted and disabled games remain excluded. Counts use the same cluster or Lightning occupancy as the card. Saved legacy Empty status chips cannot expose empty games on arrival, and clearing filters restores the hidden default.

Cash stakes default from highest to smallest in both page and column ordering; featured games cannot outrank that order. Existing explicit player sort choices and seat-first tournament defaults remain available. No engine, database, seating or money changes.

Regression coverage: cash-lobby-active-defaults.law.test.tsx and lobbyViewPrefsHostileState.test.ts. Delivery and live evidence are recorded in the owning task checkpoint.
