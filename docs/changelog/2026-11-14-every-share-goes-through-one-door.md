# 2026-11-14 - every share goes through one door

Dan: "THE SHARE LINKS ISN'T WORKING FOR THE TOURNAMENTS OR OTHER 'SHARE STATS'
OR SHARE TOURNAMENT ON BREAK ... GET TO THE ROOT CAUSE AND HARD CODE FIX ANY
AND ALL ISSUES WITH THE LINK SHARING FOR STATS, HANDS TOURNAMENTS ETC."

## What was measured

- The links themselves resolve. Opened signed out on production:
  `/hub/club-arena/tournaments/<id>` goes to sign-in and carries the return
  path; `/h/<token>` draws its preview and opens the replay.
- The sending side was the defect. `ca_shared_hands` over nine days: 575 links
  reserved, 2 ever marked sent. No share failure had reached
  `client_error_events`, because most handlers swallowed it.
- In a desktop Chromium with no Web Share, `navigator.clipboard.writeText`
  answered `NotAllowedError: Document is not focused`. That is the only step
  the tournament, break-screen, session and ranking shares had.

## The cause

About twenty-five share and copy buttons each carried their own copy of
"system sheet, else clipboard". Each dead-ended somewhere different:

- a sheet that refused (anything but the player closing it) ended the tap;
  only a browser with no `navigator.share` at all reached the clipboard;
- the clipboard step was a bare `writeText`, so a present-but-denied Clipboard
  API did nothing. `src/lib/copyToClipboard.ts` fixed exactly this on
  2026-11-06 for the two hand-link buttons and nothing else;
- failures were swallowed, so nothing was visible to anyone.

## The fix

`src/lib/share.ts` is the one ladder: native sheet or Web Share; a refusal
that is not a cancel falls through and is reported; the clipboard with the
selection copy behind it; only then "failed", shown with the link so it can
be copied by hand. Every share and copy surface calls it:

break screen, tournament details, tournament ranking card, session summary,
Lightning summary, stats card, achievement card and page, Share Hand, hand
detail Link, hand archive request, bonus replay, Share & Invite sheet,
referral dashboard and modal, public profile, wallet, club settings, club
home, club rules, club context menu, player invite modal, device check,
Diamond earn, cashier copy.

Link content corrected on the way through:

- the ranking card shared the bare lobby; it now shares the tournament;
- the session and Lightning summaries shared a sentence with no link; they
  now carry one;
- every tournament share builds its address with `tournamentShareUrl`.

## Pinned

`tests/every-share-goes-through-one-door.law.test.ts` (no `navigator.share`
or `clipboard.writeText` outside the door) and `tests/unit/shareDoor.test.ts`
(each dead end, as a case). Six source-text pins that named the old raw
calls moved to the new mechanism in this commit.

## Not changed

No server, schema or engine change. Recipient pages and routes are untouched.
