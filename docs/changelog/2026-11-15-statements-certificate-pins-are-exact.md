# The Statements certificate's pins are exact lines (2026-11-15)

Follow-up to #10940, closing overwatch's notes on its review of e4cb37d2.

- The unit test now pins the refusal check and the totals comparison as exact whole lines, in order. A commented-out refusal check or an inverted `.not.toBe('matches the server')` fails it. Before, both still passed.
- The earlier "terminal state" poll no longer prints the club's figures into the run log; it reports how many it saw.
- The helper says plainly that both sides go through `Number()`, so the comparison is exact to double precision only.

Test-only. Proof: 9 of 9 at head; three mutations (refusal commented out, comparison inverted, figures printed) each fail.
