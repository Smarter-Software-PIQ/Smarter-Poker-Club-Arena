# A Stats Section Tab Is Never Narrower Than Its Label

Date: 2026-11-28. Lane: club-arena-client.

## What failed

Post-deploy run 46101513017 (live `a735262e5`), `tests/e2e/stats-deep.spec.ts`
"traverses every owner Stats surface and preserves club and range scope",
stopped at `tests/e2e/support/statsPanelLayout.ts:86` with
`{ tab: "Performance", width: 6, clearance: -1.89 }`. Here `width` is the
6px border-image edge of the tab's `::after` chrome, and `clearance` is how
far the label sits from the nearer frame edge. At 480px the label ran about
2px into the chrome.

## Cause

`src/pages/PlayerStatsPage.css` put the section tabs in fixed grid tracks,
`repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr))` (#12031). That 6.5rem
width assumed a condensed face. The tab font comes from
`src/components/lobby/ArenaWorkspace.css`. At `a735262e5` it was
`700 12px 'Arial Narrow', Arial, sans-serif`, and Linux and Android do not
ship Arial Narrow, so PERFORMANCE (uppercase, 0.09em tracking) drew in an
Arial-width face at 105.9px inside a 107.5px track. A grid track cannot grow
for its label. Measured in the harness:

| Face                     | 393px | 480px | 500px |
| ------------------------ | ----- | ----- | ----- |
| Arial width, before      | 4.89  | -2.39 | 2.61  |
| Roboto Condensed, before | 14.19 | 10.11 | 12.61 |

(lowest clearance in px; the chrome needs 6)

The defect was older than the run that caught it. The spec runs in serial
mode, and the earlier "separates published cash and tournament samples"
test kept failing, so Playwright skipped this test until #12276 fixed the
earlier one. #12275 (after the live SHA) now puts the self-hosted Roboto
Condensed first in the stack, which fixes the common case. But the layout
still overflowed whenever that face was not drawn (the swap period, or a
failed font load).

## Fix

The tabs now wrap as flex items. Each tab still asks for 6.5rem
(`flex: 1 1 6.5rem`), but none may shrink below `max-content`, which is its
label plus 8px of inline padding on each side, past the 6px chrome. Where
three tabs fit on a row (a 20rem container query on the bar, with four or
more tabs), a tab stops growing at a third of the row. That keeps a short
last row on the grid's column width.

With Roboto Condensed, every tab is the same width as before at 393, 480 and
500px. With an Arial or DejaVu width face, a crowded row moves a tab to the
next row instead of overlapping its edge. The lowest clearance is now 8px at
every width. No text size, case or tracking changed.

Pinned by `tests/unit/statsTabsAreNeverNarrowerThanTheirLabel.test.ts`, which
fails on the previous CSS. The rendered proof stays
`expectStatsTabLabelsFit`, and its tolerance is unchanged.
