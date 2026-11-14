# Chip formatters are one figure, and none receives raw arithmetic

Follow-up to `2026-11-14-real-figures-are-never-abbreviated.md`.

**One figure.** `exactChips`, `feeFigure`, `formatWalletChips`, `winLossChips`,
`formatChips` and `formatSignedChips` each carried their own copy of the same
sign, places and grouping logic. They are now one private `chipFigure` with
each name's minimum places, sign style and fallback, so one value cannot print
two ways after an edit to one copy. `compactChips` and `fmtChips` stay as
aliases of `exactChips` (about 370 call sites, no churn). The unused
`preciseMagnitude` is removed. Output is unchanged: 26 inputs through 12
formatter variants gave byte-identical results before and after, and
`tests/unit/chipFormattersShareOneFigure.test.ts` pins the relations.

**No raw arithmetic.** The formatters print exactly what they are given, so
`exactChips(0.1 + 0.2)` prints `0.30000000000000004`.
`tests/a-chip-formatter-never-receives-raw-arithmetic.law.test.ts` scans every
source file for a chip formatter, or a file-local alias of one, whose figure
argument holds a bare `+ - * /` outside `sumChips`, `chipCents` or
`Math.trunc` / `Math.round`. It finds none today.
