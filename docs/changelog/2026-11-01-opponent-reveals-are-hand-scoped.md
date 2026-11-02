# Opponent public reveals expire at the hand boundary

HAND_STARTED advanced the hand number while retaining opponents' previously public cards. A subsequent hidden snapshot was then treated as the same hand and restored those old cards, making previous holdings appear face up during the new deal, including apparent conflicts with the current board.

The new-hand reset clears every opponent's hole cards and reveal flag while preserving a fresh Hero delivery already received for that hand. Public opponent holds now require a positively identified matching hand; Hero's existing recovery behavior is unchanged. Legitimate same-hand showdown, all-in and voluntary public reveals remain available.

Regression tests execute the actual tracked hand-start mapper and snapshot merge through the TypeScript AST. They cover consecutive boundaries, missing and invalid hand identities, replacement seats, persistent player status, valid public holds and fresh/old Hero cards. The original code failed seven cases before the correction. Server reveal gates and transport sequence fences were reviewed; no engine or transaction change is required.
