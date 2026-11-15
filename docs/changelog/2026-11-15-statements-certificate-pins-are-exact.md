# The Statements certificate's pins are exact lines (2026-11-15)

Follow-up to #10940, closing overwatch's notes on its review of e4cb37d2 and the independent review of this change's first head (849b09ec).

- The unit test pins the refusal check, the request match, the expected figures, the per-figure comparison (`figures[index] !== expected[index]`) and the verdict as exact whole lines, in order. A commented-out refusal check (by `//` or inside a `/* ... */` block), an inverted `.not.toBe('matches the server')`, `===` for `!==`, a figure compared with itself, or an early return that claims a match each fails it.
- The comparison poll must be awaited and must sit inside the authorized branch that the refusal check guards.
- The earlier "terminal state" poll no longer prints the club's figures into the run log; it reports how many it saw.
- The helper says plainly that both sides go through `Number()`, so the comparison is exact to double precision only.

The comparison poll must also sit directly in that branch, not under a further condition, and only the verdict may say "matches the server".

Test-only. Proof: 9 of 9 at head; the three original mutations and seven later ones (=== for !==, a figure compared with itself, an early match, a dropped await, a block comment, the poll moved into the refusal branch, the poll under a further condition) each fail.

Limits: source-text pins narrow the ways to weaken the certificate but cannot rule out every rewrite that keeps the pinned lines intact (for example a block comment opened at the end of a line); the pins are exact lines, so reformatting them needs the test updated; the privacy guard catches the literal `figures.join('|')` only; and older failure messages outside this change (the totals text, the entry pill, `expectExactCashierFigures`) can still show figures when a check fails.
