# 2026-11-13 - A lobby tab keeps the page it was left on

Dan: "WHEN I CLICK ON A + BUTTON AND GO TO THE LOBBY. THEN SELECT ANYTHING LIKE
PLAYER MANAGEMENT... THEN GO BACK AND VIEW ANOTHER OPEN TAB... BUT GO BACK TO
'LOBBY TAB' AND ITS NO LONGER PLAYER MANAGEMENT IT DEFAULTS BACK TO THE GAME
LOBBY... KEEP IT ON THE EXACT PAGE YOU LEFT IT ON".

## Root cause

Player Management (`/clubs/:id/members`) and the other club pages are real
routes, not in-tab renderers. Opening one from the "+" lobby tab hides the
MultiTablePage container; the pinned strip keeps the Lobby pill lit, but the
tab itself never knew it was on that page. Selecting the pill again ran
`handleTabSelect`'s lobby branch, which borrows an open table's URL to un-hide
the container and renders the tab's only content: the club game lobby.

## Fix

- `TableInstance.lobbyOffRoutePath` records the route (pathname + search) a
  lobby tab is showing while the container is hidden with that pill selected,
  following the player deeper (member profile, statistics).
- `handleTabSelect` sends a pill with a remembered page back to it, before the
  active index moves; the pill is focused only once the route has left
  `/table/*`, so the game lobby never paints on the way.
- The page is forgotten when the tab shows its in-tab lobby again, or when the
  player Backs out of the page onto a table.
- Decision logic is pure in `src/utils/lobbyOffRoute.ts`, pinned by
  `tests/a-lobby-tab-keeps-the-page-it-was-left-on.law.test.ts`.
