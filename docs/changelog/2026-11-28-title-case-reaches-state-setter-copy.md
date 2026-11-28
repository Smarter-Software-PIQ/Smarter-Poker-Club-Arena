# Title Case reaches the messages a page stores and prints

`check-title-case` read JSX text, UI attributes, copy properties and native
dialogs. A message handed to a state setter, such as
`setError('Failed to load agent hierarchy')`, is stored and then rendered as
the page's error or status line, but it is a call argument, so the gate never
saw it. About ninety such strings shipped lower case ("User not found",
"Failed to send request", "Could not load your club cashiers.").

- `scripts/ci/check-title-case.mjs` now reads prose (text with a space) passed
  to setters named for a player-facing message (`setError`, `setLoadError`,
  `setStatusMessage`, `setNotice`, `setWarning`, `set*Error` and the like). A
  status value such as `setFeedback('idle')` or `setError(null)` is untouched.
- `--fix` corrected 90 strings across 33 files; 12 tests and 2 e2e specs that
  asserted the old wording follow it.
- Law: `tests/state-setter-copy-is-title-cased.law.test.ts` runs the gate
  against fixtures (six flagged forms, five accepted ones).

Rates were also audited: every other `{...Rate}%` print in `src` already holds
a true percentage (win rate, scoop rate, take rate, commit rate); the agent
commission fraction fixed in #12324 was the only one printed raw.
