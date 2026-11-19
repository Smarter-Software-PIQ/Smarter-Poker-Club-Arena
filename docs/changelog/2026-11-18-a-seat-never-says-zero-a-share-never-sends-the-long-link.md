# 2026-11-18: a seat never says zero, a share never sends the long link, the dock never prints a browser error, the add-on holds the clock a player reads

Four things Dan reported from the tables on 2026-11-18. This entry is the
client half. The engine half of the first one is
`2026-11-18-the-level-clock-stops-when-the-add-on-drain-starts.md`.

## 1. "THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO"

"WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON, THEIR
STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."

**Root cause.** A player who holds a chair but is not in the hand being played
(waiting for the big blind, waiting for the button, just bought in, just moved)
is drawn from a stand-in until the engine's roster carries them. The stand-in
read `lightningWaitingSeat?.stack ?? heroRowStack ?? pendingSeatStackRef.current ?? 0`.
The last two fall through to the number 0 whenever nothing has been confirmed
yet: before the first seat read answers, after a buy-in recovered from its
receipt (which deliberately does not paint the old amount), on every tournament
seat (no buy-in sheet), and for another player first seen through presence
(`stack: existing?.stack ?? 0`). The production seat rows were checked: 739 live
seats, none holding zero. The zero was only ever on the screen.

The same defect was fixed once for one source on 2026-10-12 (a seat holding
3,632 read 0.00) by adding the seat-row read. Every other source kept the
fallback, so it came back.

**Fix.** `src/lib/standInStack.ts` is the one rule for every stand-in: the best
confirmed balance is shown, and an unknown balance is marked pending (the seat
draws its loading mark) and is never printed as a number. A confirmed zero is
still a zero. Both stand-ins in `TablePage.tsx` go through it.

**Regression lock.** `tests/unit/standInStack.test.ts` pins the rule and pins
that the two fallbacks are gone from the page source.

## 2. The Share sheet handed out a link thousands of characters long

"IT SHOULDN'T HAVE THIS LONG LINK, IT SHOULD BE CLIPPED LIKE THE 'LINK' COPY
AND PASTE."

**Root cause.** The short link (`smarter.poker/h/<token>`) is reserved when the
hand or the sheet opens. `useSharedHandShortLink` returned `url: null` from the
instant the payload changed until the reservation answered, and every caller
read null as "send the long link". A hand shared while its recording is still
being written changes payload several times in a few seconds. Production shows
it for the reported hand: three reservations in ten seconds (19:20:51, 19:20:54
and 19:21:01 UTC, payloads of 1,056, 3,030 and 3,540 characters), every one of
them successful, and the row for the link that was pasted still marked unsent.
The short link existed. The sheet had dropped back to the long one in the gap.

**Fix.** The hook now says `pending` and offers `ready()`. The Share sheet
shows "Creating Your Short Link" and sends nothing until the link lands; the
Link button in the hand popup waits for the reservation in flight. One failed
reservation is tried again. Only a reservation that has really failed, or not
answered within eight seconds, falls back to the long link, so sharing still
works with the database unreachable.

**Regression lock.** `tests/unit/shortSharedHandLinks.test.tsx`: the sheet shows
no long link and copies nothing while pending; Link tapped before the
reservation answers sends the short link.

## 3. "signal timed out" in red above the chat button

**Root cause, in two layers.** The text is the browser's own message for a
request that passed the Messenger dock's 30 second ceiling
(`AbortSignal.timeout(30000)` in `bindDockRequest.mjs`). The dock wrote
`failure.message` straight to the screen, in the strip that floats over the
page, for a refresh nobody had asked for. The request itself was slow because
of the World Hub inbox loader; that is fixed in the World Hub repository
(`messengerWorkspace.mjs`, the dock now loads what the dock shows).

**Fix here.** `dockFailureText` says a transport failure plainly and keeps any
message the Messenger API wrote itself. A background refresh reports inside the
open inbox, with Retry, and never floats over the page; only something the
player tapped can put a message in the strip.

**Regression lock.** `tests/unit/messengerDockFailureText.test.ts`.

## 4. The level clock on screen kept running into the add-on

The engine stops the level clock for the add-on (see the engine entry). Every
screen computes the clock from `level_started_at`, which the engine re-anchors
only when the add-on minute ends, so the clock a player read counted down
through the drain and the minute and then jumped back.

**Fix.** `src/utils/addOnLevelClock.ts` answers from the row alone whether the
event's clock is stopped for its add-on and at what instant it stopped: from
the entry boundary (the level cap, or the late registration clock) through the
closing minute, and until the re-anchored row is read. `levelClockNow`, which
the HUD, the blinds tab, the lobby rows and the tournament pages all measure
through, applies it. The dock shows the drain the way it shows the last hand
before a break.

Until the engine half is live (it activates only in the 04:00 maintenance
window), an event whose entry closes on the clock rather than on a level will
show the level held through the drain and then lose the drain's seconds when
play resumes. An event that closes on a level is already exact.

**Regression lock.** `tests/the-add-on-phase-stops-the-level-clock.law.test.ts`.
