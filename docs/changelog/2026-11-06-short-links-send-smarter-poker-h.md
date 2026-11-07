# Short shared-hand links are sent as smarter.poker/h/<token>

Last step of the short-link work (`2026-11-06-short-shared-hand-links.md`).
Link and Share now send `https://smarter.poker/h/<token>`: the World Hub page
(Smarter-Poker-World-Hub #2699) draws the messaging-app preview (sender, hand
number, table, pot in chips, board) and sends a person straight on to
`/hub/club-arena/h/<token>`, which opens the hand and counts the view. A link
already sent as `/hub/club-arena/h/<token>` keeps opening; nothing about the
token, the table or the doors changes.

Shipped only after the World Hub page was live, so no link ever pointed at a
page that did not exist yet. Pinned in `tests/unit/shortSharedHandLinks.test.tsx`.
