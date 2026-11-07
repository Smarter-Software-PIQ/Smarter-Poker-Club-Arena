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

## Copy Link works where the clipboard is refused, and only a real send counts

Found while verifying the short links live: in the desktop app's built-in
browser the Share Hand popup's Copy Link did nothing. `navigator.clipboard`
existed but refused (`NotAllowedError: Write permission denied`), and both copy
buttons fell back to the selection copy only when the API was missing. The
modal's Link button also marked a short link as sent on the tap itself, before
knowing whether the copy happened.

- `src/lib/copyToClipboard.ts` tries the Clipboard API, falls back to a
  selection copy when it is refused, and answers whether a copy happened.
- ShareHand and the hand detail Link button both use it. A short link is
  counted as sent only after the share sheet sent it or the copy succeeded.
- `tests/unit/copyToClipboard.test.ts` pins the refused, missing and
  nothing-works cases.
