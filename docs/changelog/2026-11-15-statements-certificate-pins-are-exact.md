# The Statements certificate's pins are exact lines (2026-11-15)

Follow-up to #10940, closing overwatch's notes on its review of e4cb37d2 and the independent review of this change's first head (849b09ec).

- The unit test pins the refusal check, the request match, the expected figures, the per-figure comparison (`figures[index] !== expected[index]`) and the verdict as exact whole lines, in order. A commented-out refusal check (by `//` or inside a `/* ... */` block), an inverted `.not.toBe('matches the server')`, `===` for `!==`, a figure compared with itself, or an early return that claims a match each fails it.
- The comparison poll must be awaited and must sit inside the authorized branch that the refusal check guards.
- The earlier "terminal state" poll no longer prints the club's figures into the run log; it reports how many it saw.
- The helper says plainly that both sides go through `Number()`, so the comparison is exact to double precision only.

Test-only. Limits: the pins are exact lines, so reformatting those lines needs the test updated with them; older failure messages outside this change (the totals text, the entry pill) can still show figures when a check fails.
