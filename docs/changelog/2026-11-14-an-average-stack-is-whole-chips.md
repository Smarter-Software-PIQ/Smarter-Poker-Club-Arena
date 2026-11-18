# An average stack is whole chips

Dan 2026-11-14, with a Ranking tab reading "7,694.8051948052 / 9 BB": "AVG STACK
SHOULDN'T USE DECIMALS, THATS THE ONLY NUMBER THAT SHOULDN'T. CHIP STACK COUNTS
AND 'AVERAGES' USE WHOLE NUMBERS EVERYWHERE."

The current Ranking tab already truncated its field average (live check: 5,731,
22 BB); the screenshot came from a tab running an older bundle. The rule now
holds on every surface, at the computation and at the display:

- Tournament Tables tab: each table's Average was `total / count` with no
  truncation, so it could print decimals. Now truncated.
- Tournament clock and info panel rounded the average to the nearest chip
  (`Math.round`); they now truncate (never rounded up), like every other.
- HUD and break screen truncate an average another component supplies.
- Cash must-move lobby: the table header's Avg Stack is whole chips
  ("23", not "23.50"); its Total Chips keeps the cents.
- New `stackChips` prints tournament stack figures (average, chips in play,
  smallest / biggest stack, chip swings, gap to the leader) as whole chips.

Money keeps its cents; cash-table seat stacks are money and keep theirs.
Pinned by `tests/an-average-stack-is-whole-chips.law.test.ts`, which also scans
every source for an average-stack division that is not truncated.
