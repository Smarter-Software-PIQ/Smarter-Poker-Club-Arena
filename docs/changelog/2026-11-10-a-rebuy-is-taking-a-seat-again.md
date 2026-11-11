# A rebuy is taking a seat again (2026-11-10)

## Report

MichaelJordan (Kings Club), Monday Night Turbo, to his agent: after a rebuy he
"could not see my cards", his stack "dwindled", signing out and back in brought
the cards back, and he asked for two rebuys to be credited.

## What the rows say (production observation)

Tournament `c4a7ba9b-482a-49b0-85ee-0d65303898c6`, player
`c657675c-f970-4c42-8f19-ba4d8096be67`, times UTC on 2026-11-10.

- Purchases (`tournament_participant_funding_receipts`, matched one for one by
  `chip_ledger`): entry 20 at 01:50:41, rebuy 20 at 02:19:28, rebuy 20 at
  02:23:29, add-on 20 at 02:32:36. 80 chips in all; `tournament_players.rebuys`
  is 2. His "third rebuy" was the add-on. Finished 31st at 03:09:38, no prize.
- CONFIRMED from `hand_history`: after the first rebuy (stack 5,000, same
  table, same seat 7) three consecutive hands each ended in a fold with
  `origin: forced` after the clock ran out: 02:20:08 (35.6 s), 02:20:53
  (35.7 s) and 02:21:42 (17.2 s). The third was his big blind holding A3 of
  diamonds and cost 1,600 of the 5,000. His next action, 37 s into the
  following hand, was his own all-in for 3,400, which lost.
- INFERRED, not proven: that his screen showed no hole cards during those
  hands. The database records forced folds, not what the page displayed. The
  client fault below produces exactly that, and his account (cards returned
  after signing out and in) matches it; `client_error_events` shows build
  `b64b4a00` at 02:03 and `51a3451e` by 02:31, so the page was reloaded in
  between.
- NOT SUPPORTED: the same after the second rebuy. Every action after it is
  `player` or `pre_action`; he won the first hand after it.
- Separately, eight forced or pre-action folds between 02:01 and 02:08, before
  any rebuy, follow the hourly break; he did not report those.

## Cause (client, `src/pages/TablePage.tsx`)

A tournament bust vacates the physical seat. The page answers that through
`applySeatRemoved`, from either of two callers: the engine's `seat_left` with
reason `busted_awaiting_rebuy_decision`, or the ten-second `table_seats` read
that no longer finds the player's row. `applySeatRemoved` sets
`leftSeatPendingRef`, a latch its own comment says is "cleared only by taking a
seat again".

The first buy-in receipt and the cash buy-in receipt clear it. The tournament
rebuy receipt (`onConfirmRebuy`) restored `heroSeat` and did not. While the
latch is set the page strips the player's own row from every snapshot, a resync
zeroes the seat, and, since #10215 on 2026-11-09, the hole-card door drops every
delivery ("a player who has asked to leave is shown no further cards"). The
build he was on contained #10215. A reload starts the latch clear, which is why
signing in again brought the cards back.

His first rebuy took 12 s, longer than the ten-second seat read, so that read
ran while he had no seat. His second took 8 s.

## Fix

The rebuy receipt clears the latch, like every other paid seat. It also stamps
`seatAcquiredAtRef`, so a seat read that began before the purchase and answers
after it falls inside the existing 15 s fresh-seat window and cannot set the
latch again, and it resets `bootNoticeShownRef` as the first buy-in does. The
receipt already asks the engine for a snapshot, which re-pushes the hand's hole
cards.

Client only. No engine, schema, chip or seat change.

## Pinned

`tests/a-rebuy-is-taking-a-seat-again.law.test.ts` runs the page's own
`applySeatRemoved`, rebuy receipt handler and hole-card door in the order of
that hand: bust, rebuy, deal. Four of its six cases fail on the page before
this change.

## Browser fixture (fixture evidence only, not production observation)

`tests/live-turn/tournament-rebuy-hero-cards.pw.ts`, CI step "Tournament
rebuy hero cards gate": the built app at a tournament table in a phone
viewport, a mocked Supabase and an engine socket speaking the production
protocol. The rebuy is a recorded receipt; no chips move and no real player
is involved. Bust (settled zero-stack snapshot, seat row removed, `seat_left`
`busted_awaiting_rebuy_decision`), paid rebuy through the offer, seat
restored, then:

1. the next two hands are dealt face up;
2. cards that arrive before the seating snapshot are shown;
3. a lost delivery is recovered from the player's own `table_hole_cards` row;
4. a late frame for the busted hand never replaces the live hand;
5. a bust that is not rebought shows no further cards (leave behavior intact).

Chromium: 10 of 10 across two repeats on the fixed build. On current main
without the fix, cases 1 to 4 fail with no hero cards shown and case 5
passes; `LIVE_TURN_EXPECT_DEFECT=1` asserts that defect and passes there.
WebKit: cases 2 to 5 pass; case 1's offer did not open within 20 s, so the
gate runs Chromium only.

## Found, not fixed here: the rebuy offer races the seat exit

Building the fixture showed that the tournament rebuy offer opens only from
the settled-seat watcher, and `applySeatRemoved` (the engine's own
`busted_awaiting_rebuy_decision` exit) dismisses the offer
(`setShowRebuyModal(false)`). The offer therefore survives only when the seat
exit lands while the page is still pricing it. If the exit lands after the
offer opens, the offer closes; if it lands before the watcher starts, no offer
opens. The fixture pins the surviving order. This is a separate defect from
the hidden cards and is not changed by this pull request.

## Not done here

No chips were moved. Proposed credit: 20 chips (rebuy 1, receipt
`tok:104a09da-c766-4f13-89c9-42304b07ad88`, 02:19:28), supported by the three
forced folds above. Held until the owner chooses the amount; it does not
gate this delivery.
