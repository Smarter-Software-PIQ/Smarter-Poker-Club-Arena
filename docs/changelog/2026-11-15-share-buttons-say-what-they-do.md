# Share buttons say what they do, the stats card carries a link, and every share is counted

2026-11-15. Follow-up to `2026-11-14-every-share-goes-through-one-door.md`
(PR #10942). Dan asked for the five improvements listed after that fix to be
built, wired in and tested.

## What changed

1. **The button says what the tap does.** A desktop browser has no share
   sheet, so "Share" there copied the link (or saved the picture) and nothing
   visibly opened, which read as "the button did nothing". `shareButtonLabel()`
   in `src/lib/share.ts` gives the resting word: Share where a sheet opens,
   Copy Link for a link and Save Image for a picture where none does. Applied
   to the tournament break screen, tournament details, the tournament result
   card, the cash and Lightning session summaries, the achievement card and
   page, the stats card, the public profile and the Share & Invite sheet.

2. **A resting word is never a status.** The session and result cards paint
   their share icon; `ChipStackReport` printed any label other than "Share" as
   a status line. It now takes the button's name and a separate `status`
   ("Copied", "Image Saved"), and only the status is printed. The Lightning
   summary's "Copied" / "Retry Share" also stayed on the button for good; it
   now returns to the resting word after a moment, like the cash summary.

3. **The stats card carries the player's link.** It shared a picture only, so
   whoever received it had nowhere to go. It now carries the public profile
   link (`profileShareUrl`) with a one-line sentence. Presentation mode, which
   hides who the player is, carries no link.

4. **Every share outcome is counted.** `shareLink` and `shareFile` record one
   `SHARE_OUTCOME` row in the existing `bus_event_log` per tap: the button
   (`source`) and the outcome (shared, copied, saved, cancelled, failed). Never
   the link, the text or the file. The row goes through this tab's own logger
   batch (`busEventLogger.record`), not the MasterBus, because the bus repeats
   events to every open tab and each tab's logger would write the tap again.
   The logger registers itself with the share door when the app starts it
   (`setShareOutcomeSink`); the door imports nothing from the logger, so the
   logger's stores never ride into a sharing surface's bundle. The first
   version imported it, and the fixture-built Diamond Spins e2e bundle
   refused the import (`resolveActiveVip` not in its header-store fixture).

5. **Tournament share preview, database side.** Migration `20261115161427`
   adds `fn_ca_tournament_share_preview(uuid)`, the reader behind the World
   Hub's new `smarter.poker/t/<id>` page and preview image. Lobby-card facts
   only; private, VIP-only and non-public-club events answer `{found:false}`
   exactly like a missing id. It is SECURITY DEFINER and open to anon because
   a chat app's preview crawler has no account and anon cannot read `clubs`;
   it reads no player, registration, wallet, seat or card. Recorded as a
   deliberate public reader in all four lists the audits read
   (`anonPublicSurface`, `reviewedAnonReaders`,
   `docs/security/anon-executable-definers.json`,
   `public.ca_browser_definer_allowlist`). Tournament share links switch to
   `/t/<id>` in a separate change once the World Hub page is live.

## Decided, not changed

Reserving a short hand link when the Share Hand screen opens stays as it is.
The reservation is one row per sender and hand (reused on every reopen), and
reserving before the tap is what lets the iOS share sheet open in the same tap
with the short link already in hand.

## Tests

`tests/unit/shareWordingAndOutcomes.test.ts`,
`tests/components/statsShareCardCarriesLink.test.tsx`,
`tests/components/chipReportShareStatus.test.tsx`, a `record` case in
`tests/unit/BusEventLogger.test.ts`. Seven existing tests that pinned the
word "Share" or "Send Link" in a browser with no share sheet now pin the new
word.
