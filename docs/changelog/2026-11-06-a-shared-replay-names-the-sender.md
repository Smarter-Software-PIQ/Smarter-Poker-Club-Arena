# A shared replay names the sender instead of telling the viewer "Yours"

Follow-up to `2026-11-06-a-shared-hand-link-opens-the-senders-hand.md`.

**Found while verifying that fix live** (hand #56019216, opened from its link
by a signed-out browser): the sender's own folded cards were drawn face-up
with the tag **YOURS**. A link carries the sender's unshown cards, marked
private, which is intended: they are the sender's to share. But on a link
the person watching is somebody else, or nobody signed in, so "Yours" told a
recipient that Mongo's folded King-Four was his. The same tag appeared in
the rundown ("Yours", "Yours, Not Shown") and in hand video clips, which
render through the same replayer.

## Cause

`HandReplay` reads a hand FROM `source.viewerId`. On a fetched hand that is
the signed-in viewer; on a supplied `source` (a share link or a clip) it is
the sender. The felt (`hr-seat__private`) and `HandDetailView`
(`hdv__private-tag`) both printed a literal "Yours" for that seat.

## Fix

`HandReplay` derives `privateOwnerTag`: the sender's name in possessive form
("Mongo's") when the hand came in as a supplied `source`, and "Yours"
otherwise. It passes the tag to the felt and to `HandDetailView`, which uses
it for both its action rows and its showdown rows (`privateOwnerTag` prop,
defaulting to "Yours" for every other caller). What the link carries is
unchanged.

## Pinned

`tests/unit/sharedReplayNamesTheSender.test.tsx`: the real
`SharedHandReplayPage`, opened from an encoded link, tags the sender's
private cards "Mongo's" on the felt and in the rundown, with no "Yours"
anywhere on the page. A player's own hand still reads "Yours". The test fails
against the previous source.
