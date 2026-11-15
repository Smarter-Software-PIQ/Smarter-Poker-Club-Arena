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
