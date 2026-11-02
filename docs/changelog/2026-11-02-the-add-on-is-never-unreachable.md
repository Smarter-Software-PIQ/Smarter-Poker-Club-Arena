# The Add-On Is Never Unreachable (2026-11-02)

Dan: "During the add on period, it gives you two screens to 'add on' but if you
close them both there is no way to 'add on'. It should be on the table at the
bottom of the timer, and 'Add On' button just in case."

Cause: closing the add-on break card minimized it to the corner clock
("Break: 0:36 / Paused"), and declining the offer modal closed it. The minimized
clock only reopened the card, so with both closed the table offered no direct
way to buy the add-on.

Fix: `TournamentBreakScreen` now renders the minimized clock and an **Add On**
button together (`break-screen__minimized-stack`) while the add-on period is
counting down. The button calls the same `onOpenAddOn` path as the card's
"Add On Now" button, which re-reads the durable tournament row and opens the
confirmed, price-bound offer modal. A plain break's minimized clock is
unchanged.

Pinned by `tests/unit/tournamentBreakScreen.test.tsx`
("keeps an Add On button under the minimized clock during the add-on period").
