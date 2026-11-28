# The Tournament Lobby's tab panel keeps its height (2026-11-28)

## What failed

Production post-deploy verification (run 46124486361, job 140916353382,
Desktop Chrome 1280x720) failed `tests/e2e/tournament-watch.spec.ts`
"a tournament felt opens its lobby from the top action bar" at "the tab panel
must have room to show a tab": the Tournament Lobby popup's `.details-content`
measured under 200px. The same test passed at 04:24 UTC, before #12300
reached production.

## Cause, measured

A render harness (the real `TournamentLobbyModal` + `TournamentDetails` with
a running-tournament fixture, Chrome) measured `.details-content`:

| viewport / event                  | before #12300 | origin/main | this fix |
| --------------------------------- | ------------- | ----------- | -------- |
| 1280x720, 8 tabs                  | 254           | 249         | 297      |
| 1280x720, mystery bounty (9 tabs) | 203           | **197**     | 293      |
| 375x667, 8 tabs                   | 196           | 191         | 239      |
| 375x667, mystery bounty           | 146           | 140         | 236      |
| 393x852, 8 tabs                   | 376           | 371         | 419      |

`ArenaLobbyConsole.css` lays the tab rail out as a four-column grid, so eight
tabs take two 44px rows and a mystery bounty event's nine take three (153px).
That already left almost nothing under a ~310px event plaque; #12300's
#SmarterDesign skin added a few pixels to the header and the rail
(297 -> 304, 99 -> 105 / 146 -> 153) and pushed the nine-tab case under 200.
The shell (`TournamentDetails.css`) and the selected-tab `scrollIntoView` in
`TournamentDetails.tsx` were always built for one row that scrolls sideways.

## Fix

`TournamentLobbySmarterDesign.css`: the rail is one flex row
(`flex-wrap: nowrap`, `overflow-x: auto`, hidden scrollbar), each key
`flex: 1 0 auto` and `white-space: nowrap`, the 44px floor and the #12300
chrome unchanged. Eight tabs fill the 600px lobby column exactly; on a phone,
or with nine tabs, the row scrolls and the selected tab is brought into view.

## Pinned

- `tests/e2e/css/tournamentLobbyTabPanelHeightCases.ts` (registered in the
  CSS Beat `mobile-lobby-chrome.spec.ts`): the real stylesheet stack, nine
  tabs, a 312px header, at 375x667, 393x852 and 1280x720: one row, 44px keys,
  panel >= 200px, every tab reachable without scrolling the page. Fails on
  origin/main (three rows), passes with the fix.
- `tests/unit/tournamentLobbyWearsSmarterDesign.test.ts`: the skin's rail is
  a nowrap, horizontally scrolling flex row.
