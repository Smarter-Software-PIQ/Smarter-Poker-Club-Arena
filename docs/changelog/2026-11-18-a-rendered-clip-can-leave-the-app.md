# A rendered clip can leave the app (2026-11-18)

Owner direction, 2026-11-18: "SHARE AS A VIDEO NEEDS TO BE FULLY FIXED AND
ENHANCED AND IT SHOULDN'T HAVE THIS LONG LINK, IT SHOULD BE CLIPPED LIKE THE
LINK COPY AND PASTE."

## What was missing

The clip panel in the Share Hand sheet (`src/components/table/ShareAsVideoPanel.tsx`)
could request a clip, show it and post it to the player's own feed. That was
the only thing a rendered clip could do. The mp4 could not be sent to
Messages, WhatsApp or Instagram, could not be saved, and the panel had no
access to the hand's short link (`smarter.poker/h/<token>`), which the sheet
around it already held.

The preview frame was also 16:9 while the renderer writes a portrait clip
(1080 by 1350), so the preview was a narrow strip between two black bars.

## What was built

Client only. No schema change, no engine change.

A clip that is ready, and a clip that is already posted, now show two more
buttons under the existing controls.

**Share Video.** `canShareFile('video/mp4')` (new, in `src/lib/share.ts`, the
one share door) asks once whether the device's share sheet takes a video file.

- Where it does (phones, the app): the mp4 is read to a Blob and handed to
  `shareFile` as `hand-clip-<hand number>.mp4`, with the caption as the text
  (the sheet's own sentence when the caption is empty) and the hand's short
  link in that text when there is one. The status line reads Preparing Video
  while the bytes load. If loading outlasts the tap (a browser opens a share
  sheet only from a fresh tap), the panel says the video is ready and the next
  tap sends it at once from the bytes it kept.
- Where it does not: the button sends the hand's short link through
  `shareLink` and is worded for what it does, Share Link where a sheet exists
  and Copy Link where none does. The video is not fetched.
- The long `/replay?h=` link is never sent from the panel. The panel is given
  only `shortUrl` and `shortPending`; ShareHand stays the only owner of the
  link. While the short link is being made the link button reads Preparing
  Link and is disabled. When there is no short link the link button stays
  disabled and the panel says so and points at Download. A file share with no
  short link sends the file and the caption with no link.

**Download.** Reads the mp4 to a Blob and saves it through `downloadBlob`
(the one file door) as `hand-clip-<hand number or first 8 of the hand id>.mp4`.
A cross-origin `<a download>` is ignored by browsers, which is why the bytes
are read first. If they cannot be read, the panel says Could Not Save The
Video Here and shows an Open Video In Your Browser link (the storage address
with `?download=<name>`, opened with `openInBrowser`).

**States.** Preparing Video, Shared, Saved and Link Copied are said when they
happen. A share sheet the player closed is neither a success nor a failure:
the buttons come back as they were. A failure is one plain line and the
button that failed reads Try Again. Both buttons and Post To Your Feed are
disabled while one of them is working. A link that nothing could copy is
printed on the page with `ShareLinkFallback`.

**Look.** The two buttons use a new `share-hand__video-btn--plate` variant in
`ShareHand.css`: the painted `session-button.webp` plate the Copy and Share
buttons of the same sheet already wear. The preview frame is now portrait
(4:5, at most 340px or 42dvh tall) with a thin chrome edge.

`src/services/HandClipService.ts` gained `handClipFileName`,
`fetchHandClipFile` (60 s limit, refuses an empty or non-200 answer) and
`handClipDownloadUrl`.

## Tests

`tests/components/ShareAsVideoLeavesTheApp.test.tsx` (17 tests): the file
share with its name, caption and short link; disabled buttons and Preparing
Video while loading; the second-tap path; a closed sheet; a video that will
not load and Try Again; Share Link and Copy Link where no file can be shared;
waiting for a pending short link; no short link; the link printed when
nothing could copy it; ShareHand passing the short link and never a long one;
Download with the hand number and with the short id; a download that cannot
read the bytes; a posted clip; the file name and download address helpers.

The existing `tests/components/ShareAsVideoPanel.test.tsx` (7 tests) passes
unchanged. No source-pin test quoted a changed line.

## Not verified

The buttons were exercised in jsdom and rendered in headless Chrome against a
fixture job. They were not pressed on a physical iPhone or Android phone, and
not inside the native app build.
