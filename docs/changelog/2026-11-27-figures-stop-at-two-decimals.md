# Figures stop at two decimals, anywhere and everywhere (2026-11-27)

Dan, verbatim: "NUMERS AFTER A DECIMAL NEED TO STOP AFTER 2 DIGITS ANY WHERE AND EVERYWHERE." His screenshot showed Cash Rake Today as `403.3814552027556` on Overview, Dashboard and Finance & Risk.

## Root cause

Two places printed long decimals:

1. The 2026-11-13 rule ("keep every stored decimal") made `figureMagnitude` in `src/utils/format.ts` copy every digit of a figure. Unconstrained numerics such as `rake_today` carry fifteen or more places, and every chip, fee, wallet and win / loss formatter goes through `figureMagnitude`.
2. Hundreds of call sites print with a bare `Number#toLocaleString()`, which the browser formats with up to three decimals and rounds.

## Fix

- `format.ts`: `DISPLAY_PLACES = 2`, `displayFraction()` and `displayDigits()`. `figureMagnitude` prints at most two decimals. Extra digits are **cut, never rounded**, under the 2026-09-04 rule "ABSOLUTELY ZERO ROUNDING ANYWHERE EVER": `0.999` prints `0.99`. `chipFigure` decides zero from the printed digits, so `-0.004` prints `0`, never `-0.00`.
- `playerRecordMoney.ts` uses `displayDigits`.
- `src/utils/twoDecimalDisplay.ts` (new) caps `Number.prototype.toLocaleString`: a call with no fraction or significant-digit limit gets at most two decimals with `roundingMode: 'trunc'` (or a digit cut where the browser lacks it); a call asking for more than two is clamped to two; percent, compact, significant-digit calls and calls asking for two or fewer are untouched. It is idempotent and the first import of `src/main.tsx`.

## Kept exact on purpose

Stored values, `figureDigits`, sums (`sumFigures`, `sumChips`) and CSV exports keep every digit. An export cut at two places would have rows that no longer add up to its own totals.

## Tests

- New law: `tests/figures-stop-at-two-decimals.law.test.ts` (`docs/laws.d/figures-stop-at-two-decimals.md`).
- Superseded expectations updated in the same commit: `tests/real-figures-are-never-abbreviated.law.test.ts`, `tests/unit/compactChips.test.ts`, `tests/unit/profileCredential.test.ts`, `tests/unit/rosterPeriodSummary.test.ts`, `tests/club-data-shows-the-accounting-window.law.test.ts`, `tests/cashier-club-load-order.test.tsx`, `tests/unit/memberTransactionReceipt.test.tsx`.
