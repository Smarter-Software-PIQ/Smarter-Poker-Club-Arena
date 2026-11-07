# Shared hand links: one tap on phones, the sender's referral, and a reply for old links

Follow-ups to `2026-11-06-a-shared-hand-link-opens-the-senders-hand.md` and
`2026-11-06-a-shared-replay-names-the-sender.md`, built on Dan's instruction to
finish every improvement offered after that fix.

## One tap from Link to Messages

`HandDetailModal`'s Link button opens the system share sheet on a phone
(`(pointer: coarse)` and `navigator.share`), so sending a hand is one tap
instead of copy, switch apps, paste. Elsewhere it copies as before. Dismissing
the sheet (`AbortError`) copies nothing behind it; any other refusal falls back
to the copy so the tap is never lost. The button reads "Sent" after a share.

## The sender's referral rides with every shared hand

A shared hand is usually opened by a friend with no account. Link and Share now
add the sender's own Share & Invite code as `&i=<CODE>` beside the payload (the
hand codec and every link already sent are untouched). The code comes from
`useSenderInviteCode`: the sender's link for the club hosting the hand's table
(`fn_club_invite_link`, which requires membership and reuses an existing code),
else the sender's own active club for a union table they are not a member of.
It is fetched when the hand or the Share sheet opens, because a phone only
opens its share sheet straight from the tap.

`SharedHandReplayPage` offers a signed-out viewer a #ClubArenaConsole panel
("Play This Game", "<Sender> Invited You") with Create Account through
`/i/<CODE>`, the existing World Hub door that sets attribution, sends a new
player to signup and places them in the sender's downline. Without a code it is
plain signup. Sign In and signup both return to the replay. Signed-in players
see nothing extra. No new attribution path exists: the World Hub page and
`fn_redeem_club_invite_code` do the crediting exactly as for Share & Invite.

`normalizeInviteCode` moved to the pure `src/lib/inviteCode.ts` (re-exported by
`ClubInviteService`, one rule) so link builders and `ShareHand.tsx`, which also
holds the hand codec, never load the Supabase client.

## Old links: Ask For A Share Link

The note an old archive link shows to someone who was not dealt into the hand
gains "Ask For A Share Link". It cannot name who sent the link (the hand is
unreadable to this viewer, and naming its players would reveal who was in it),
so it hands the viewer a ready reply (`SHARE_LINK_REQUEST`) to paste back into
the conversation the link came from: into the share sheet on a phone, onto the
clipboard elsewhere.

## Pinned

- `tests/unit/sharedHandLinksTravelWell.test.tsx`: `&i=` is appended only for a
  valid code; the service re-exports the one rule; Share carries it and its
  codec file loads no client; the code is the table club's, else the sender's
  own, else none, and a signed-out sender is never asked; the real replay page
  sends Create Account to `/i/<CODE>` (or signup) and Sign In back to the
  replay, and shows nothing to a signed-in viewer; the old-link request names
  nobody.
- `tests/unit/previousHandPhase1.test.tsx`: on a phone the real modal hands the
  share sheet the replay link and copies nothing; dismissing copies nothing; a
  different refusal copies; a desktop with a share sheet still copies.
