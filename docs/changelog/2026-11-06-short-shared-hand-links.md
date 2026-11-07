# Short shared-hand links, with views and Stop Sharing

Built on Dan's instruction to finish every improvement offered after the
shared-hand-link fix (`2026-11-06-a-shared-hand-link-opens-the-senders-hand.md`).

## Why

A shared hand travelled only as `/hub/club-arena/replay?h=<payload>`: the hand
rides inside the address, 480-600 characters long. Messengers wrap or cut links
that long, a sender could not take one back, and nobody could tell whether it
was opened.

## What

Migration `20261107021555_short_share_links_for_hands.sql` adds one record table,
`ca_shared_hands` (token -> the SAME payload the long link carries, the sender,
their Share & Invite code, a few preview facts, sent/revoked/view bookkeeping),
and four doors:

| door | who | does |
| --- | --- | --- |
| `fn_ca_shared_hand_reserve` | signed-in sender | the sender's token for this exact hand, one per sender and payload, reused; made when the hand opens |
| `fn_ca_shared_hand_mark_sent` | sender | records that Link or Share actually sent it |
| `fn_ca_shared_hand_open` | anyone (anon too) | payload + invite; counts a view unless it is the sender or a preview crawler (`p_count = false`); a revoked link carries no hand; a deleted sender's links open nothing |
| `fn_ca_shared_hand_revoke` | sender | stops sharing; the next share makes a new token |

The table is closed to `anon` and `authenticated`; only the doors reach it. No
foreign keys (production DDL rule 7), no cron, nothing that repairs anything.

Client:

- `/h/:token` (`ShortHandReplayPage`) resolves the token and renders the same
  `SharedHandReplayPage` the long link renders, with the sender's invite door.
  Revoked, missing and unreachable each say so plainly; "could not load" is never
  reported as "does not exist".
- `useSharedHandShortLink` reserves the token when the hand popup or the Share
  sheet opens, so the Link tap hands a phone's share sheet a finished address at
  once. Until it answers, or on any failure, the long link is sent: it needs no
  server at all.
- The popup shows the sender "Shared · N Views" with **Stop Sharing** once the
  hand has been sent.
- The Share sheet sends the short link and records the send; its embed code
  picks `?` or `&` to match the link, and its copy button gains a label.
- `/h` shares the replay's quiet chrome (no club footer, no push prompt).

The preview facts (hand number, table, stakes, pot, board, sender name) are what
the whole table saw; no hole cards. They feed the link preview (World Hub
`/h/<token>`, a separate change).

## Proof

- `scripts/dev/test-shared-hands-postgres.sh`: the migration on a throwaway
  cluster, every door as the role that really calls it, 23/23 PASS (token reuse,
  refused payloads, >255-character payloads, anon refused the table and
  reserve, counted and uncounted views, another player cannot revoke, revoked
  links carry nothing, a deleted sender's link opens nothing).
- `tests/unit/shortSharedHandLinks.test.tsx`: the service, the `/h/:token` page
  in all four states, the real popup sending the reserved short link, marking it
  sent, showing views and stopping, the long link standing in when the
  reservation fails, the Share sheet, and the route registration.
