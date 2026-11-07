# The Free Roll Second Title Matches The Title Size

Dan, 2026-11-07, an hour after the second title shipped: "BLUE FONTS NEED TO
BE LARGER. THEY ARE TOO SMALL. THEY SHOULD BE THE SAME SIZE OR SLIGHTLY
SMALLER THEN THE WHITE 'TITLE FONT'."

## What changed

- `src/components/lobby/PremiumMttRows.css` - the freeroll second title on
  the premium chassis prints at `clamp(10px, 3.1cqw, 23px)`, one notch under
  the title's `clamp(11px, 3.4cqw, 26px)`, multiplied by the same
  `--premium-title-fit` so the pair shrink together, and by its own `--fit`.
- `src/components/lobby/LobbyTable.tsx` - the line renders through
  `HeadingFormatLine`, a `useFitText` wrapper on the same name face, so a
  long combination ("Progressive Knockout · All In Or Fold") shrinks to fit
  rather than losing its last words.
- The `text-overflow: ellipsis` clamp is gone: the fitter lands within a
  fraction of a pixel of the face width, and at that equality the ellipsis
  ate the final glyph (the same subpixel trap recorded in `useFitText`'s
  header, measured here as "ALL IN OR FO..." on a fitted line whose integer
  scrollWidth equalled its zone).
- `src/components/lobby/LobbyTable.css` - the base (non-chassis) rule steps
  from 11px to 12px against its 13px title.

## Proof

Headless chromium renders at 393px and 900px: every freeroll variant prints
its line at the title's size minus a step, the long PKO + All In Or Fold
combination prints whole and fitted, and paid cards are unchanged.
`npx tsc --noEmit` clean; the second-title regression suite and the lobby
title/schedule/UI-proof suites all green (104 tests).
