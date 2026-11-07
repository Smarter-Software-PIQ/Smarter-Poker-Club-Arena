# Free Buy tickets are shown, and a refusal says why

2026-11-07. Migration `20261107043307`.

## What the owner asked

Show players how many of their five daily Free Buy tickets are left, and say
plainly when a registration is refused for want of one instead of a generic
error.

## What was wrong

- `fn_ca_free_buy_tickets()` reads TODAY's gaming day, but a ticket is drawn
  from the gaming day of the EVENT's start (`free_buy_ticket_redeem`), and
  Midway Free Buys open days ahead. A count read the obvious way would have
  been the wrong day's count.
- The redeem refuses by raising `FREE_BUY_TICKETS_USED_TODAY` or
  `FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT`. The client treated any raised
  error as a lost response: it asked a second time, reported
  `registration_result_unconfirmed`, and told the player "Could Not Confirm
  Tournament Registration. Please Refresh Before Trying Again." The
  registration had in fact been cleanly refused and nothing charged.

## What shipped

- `fn_ca_free_buy_tickets_for_event(event)` (authenticated, read-only, the
  caller's own book): applies, the event's gaming day, whether it is today,
  allotment, used, remaining, and whether the caller already holds a live
  ticket on that event.
- The Sign Up card for a free entry prints a Free Buy Ticket row, "Uses 1 Of
  3 Left Today" (or "For Saturday" when the event is on a later gaming day).
  With none left for that day the card never opens and the player is told so.
  A book that cannot be read prints nothing and the server decides, as before.
- After registering: "You Are Registered For Morning Free Buy (NLH). 2 Of 5
  Free Buy Tickets Left Today.", read back from the book the redeem wrote.
- The two refusal codes are definitive: asked once, not reported as
  unconfirmed, said in plain words ending "No Chips Were Charged."

Paid events take no ticket and are never asked about one.

## Proof

- Native PostgreSQL (`scripts/dev/free-buy-cutoff/07_tickets_for_event.py`,
  run by `test-free-buy-cutoff-postgres.sh`) over production's redeem,
  gaming-day and format functions at their md5: tomorrow's event reads
  tomorrow's book (4 used, 1 left) while today's reads 5 of 5; the count
  follows the real redeem down to a refusal at 0; used_here is per caller and
  per event and ignores a returned ticket; paid reads applies=false;
  anonymous and unknown read null; anon is refused; nothing is written.
- `tests/unit/freeBuyTicketsAreShownAndRefusalsAreClear.test.tsx` and
  `tests/unit/freeBuyTicketRefusalIsDefinitive.test.ts`.
- Renders at 393 px (#ClubArenaConsole harness): `docs/evidence/free-buy-tickets-2026-11-07/`.
  The row prints on the console glass in the card's existing row pattern; no
  new chassis, art or CSS.
