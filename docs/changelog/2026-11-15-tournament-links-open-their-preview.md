# Tournament share links open their own preview page

2026-11-15. Last step of the tournament preview (see
`2026-11-15-share-buttons-say-what-they-do.md`).

`tournamentShareUrl()` in `src/lib/share.ts` now builds
`https://smarter.poker/t/<id>` instead of
`https://smarter.poker/hub/club-arena/tournaments/<id>`. Every tournament share
(break screen, tournament details, result card) uses that one builder.

The World Hub serves `/t/<id>` (Smarter-Poker-World-Hub #2852): a chat app draws
the event's own card (name, game, buy-in, guarantee, start time), a signed-in
player is sent straight on to the Club Arena tournament page, and a signed-out
friend sees the invitation with one Register button to the same page, where
sign-in keeps the return path. It reads `fn_ca_tournament_share_preview`
(migration `20261115161427`), so a private, VIP-only or non-public-club event
gets the plain card, exactly like a missing one.

Tests: `tests/unit/shareDoor.test.ts` and `tests/unit/tournamentBreakScreen.test.tsx`
pin the new address.

## Also in this change: a copy that did not happen is said on screen

Found during the signed-in check on production (2026-11-15): in a browser
where both the Clipboard API and the selection copy were refused, Share Hand's
Copy button showed nothing at all; the failure only reached the error log.
Share Hand now says "Copy Is Blocked Here. The Link Is Selected, Copy It By
Hand." and selects the link, for Copy, for a refused Share sheet, and for Copy
Embed Code (which also now says "Embed Code Copied" when it works).

Copy-only buttons (`copyText`) are now counted in `SHARE_OUTCOME` like
shares, once per tap. The share ladder's own copy step uses the uncounted
`copyTextOnce`, so a share that falls through to the copy is still one row.
