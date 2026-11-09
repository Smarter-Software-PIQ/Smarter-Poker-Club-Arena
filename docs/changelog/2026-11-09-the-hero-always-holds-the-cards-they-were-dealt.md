# The hero always holds the cards they were dealt (2026-11-09)

## Report

Chris "Mongo", Lightning Games NLH 0.25/0.5, hand 58167350, iPhone: "Had a hand
where I never saw my cards. Waited till the time bank showed up and never saw
them." Screenshot: his turn in the small blind facing a 3.1 BB raise, no hole
cards drawn.

## What the rows say

`lightning_hand` / `lightning_hand_player`, player
`d55730d2-da5a-45fc-8478-82e49f97cd7e` (confirmed Mongo by `profiles.id`):

- 58167227: button, seat 6, won 1.25, settled 19:27:37.20 UTC.
- 58167350: small blind, seat 1, formed 19:27:40.07, `fold_type = normal`,
  folded 19:28:11.58 (31 s later, the clock), net -0.25. The hand settled
  normally for the other five seats.
- `client_error_events` holds no row for him in that window: no refused push,
  no transport loss. The client was connected and reported nothing, because
  nothing on the page considered a dealt-in hero with no cards an error.

The engine dealt and settled the hand correctly. The cards were lost on the
client. The exact frame order on his phone was not recorded, so which of the
three paths below he hit is not proven; all three end in the state he
photographed, and all three are closed.

## Root causes (client, `src/pages/TablePage.tsx`)

1. **The snapshot hold found the hero by seat index.** A public snapshot never
   carries the hero's cards; the page copies them forward from
   `prev.players[i]`. A Lightning pool seats the hero somewhere new every hand
   (seat 6 then seat 1 here), so cards written onto the previous seat were not
   found at the new one and the hero row was returned empty.
2. **HAND_STARTED kept already-delivered cards only if the deal sound had
   played.** The test was `heroDealSoundHandRef`, written only when the
   card-slide cue is audible or held. Cards delivered ahead of HAND_STARTED on
   a muted table were cleared by it.
3. **A Lightning room could not ask again.** The recovery read is off there (a
   pool session has no `table_hole_cards` row under its id) and nothing
   replaced it, so `heroCardFetchRef` was null and every "re-fetch the hero's
   cards" call on the page was a no-op. One lost private frame was the hand.

## Fix

`src/lib/heroCardCustody.ts` owns the decisions:

- `previousHeroRow`: the hero's previous row by identity, any seat.
- `heroCardHoldAllowed`: cards stamped with the incoming hand are held across
  its first snapshot; the old rule is otherwise unchanged and still fails open.
- `heroCardsAlreadyDealtFor`: HAND_STARTED asks the cards' own hand stamp
  (`heroCardsHandRef`, written for every accepted delivery) as well as the cue.
- A Lightning room re-requests through the engine's existing RESYNC
  (`onResync -> lightningRooms.rePushHoleCards`) only while the hero is dealt
  into a live hand and holding nothing, at 0.6 s, 1.2 s, 2 s and every 5 s.
  Each hand that needed it is reported once as
  `TablePage.lightning_hole_cards_rerequested`.

Client only. No engine, schema, chip or seat change. The engine API used
(RESYNC) is already live, so this does not wait for the 04:00 window.

## Pinned

`tests/the-hero-always-holds-the-cards-they-were-dealt.law.test.ts` (18 tests;
4 fail on the previous page source).

## Not done

- Mongo's 0.25 small blind in 58167350 is not refunded here. The hand was
  dealt and settled correctly by the engine; a refund is an owner decision.
- No browser run on a real phone was made from this session.
