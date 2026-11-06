# A shared hand link opens the sender's hand, not the recipient's history

**Reported 2026-11-06 (Dan, from players):** Chris sent Art a hand-history
link and Mongo sent one to Burls; each recipient landed on their OWN hand
history ("it shows mine").

## Cause

The hand detail popup's **Link** button (`HandDetailModal`, "Copy Link To This
Hand") copied the archive deep link `/hub/club-arena/hand-history?hand=<id>`.
That page is the viewer's own archive: it reads `hand_history` under RLS, which
returns a hand only to the players dealt into it. For anyone else
`getHand(id)` comes back empty, the page showed a small "not in your record"
note, and directly under it listed the recipient's own hands. To the recipient
it looked like the link had opened the wrong person's history.

The only link that works for someone who was not in the hand is the Share
sheet's `/replay?h=<payload>`: the hand travels inside the address, so it
needs no database read and cannot fall back to the viewer's records. The Link
button never used it.

## Fix

- `HandDetailModal`'s Link now copies `handShareLink(encodeHand(panelHandToShareable(hand)))`,
  the same self-contained replay the Share sheet sends, built from the same
  record. If a record cannot be encoded the copy is refused (reported), never
  replaced with the archive link.
- `handShareLink()` added to `src/lib/handHistoryLive.ts`; `handDeepLink()` is
  kept for the archive's own `?hand=` reading and documented as
  participants-only.
- Links already sent the old way: `/hand-history?hand=<id>` opened by a
  non-participant now shows ONLY a note ("That Hand Belongs To Another
  Player... Ask Them To Send It With The Share Button") and a Show My Hands
  button. The viewer's own list is no longer drawn under it. RLS is unchanged:
  an id is not consent to publish everyone's hole cards.

## Pinned

`tests/unit/previousHandPhase1.test.tsx`: the copied link is `/replay?h=`,
never `/hand-history`, and decodes back to the same hand; the modal may not
call `handDeepLink(`; a missing linked hand renders no list.
