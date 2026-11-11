# The rebuy offer survives the engine's bust exit (2026-11-11)

Follow-up to #10335 (a tournament rebuy is taking a seat again). Not the cash
countdown fix #10481, which changed only how the cash bust sheet's deadline is
set (`setBustRebuyDeadlineAt`); this is the tournament offer.

## The defect

A rebuyable tournament bust reaches the table page as two things from the
engine: the settled snapshot with the hero on a zero stack, then the seat exit
the hand-stack RPC commits, sent as `seat_left` reason
`busted_awaiting_rebuy_decision` with a snapshot that no longer has the seat.

The page's rebuy offer opened only from the zero-stack seat (the bust watcher),
and `applySeatRemoved`, which handles that exit, closed the offer
(`setShowRebuyModal(false)`). So whether a busted player was offered a rebuy
depended on arrival order:

- exit before the watcher ran: no seat to read, no offer;
- exit after the offer opened: the offer closed under the player;
- exit while the offer was still loading: the offer opened (the only order
  that worked, and the one #10335's browser fixture had to pin).

Two further holes were found while making the fixture stable:

- **The table's kind loads asynchronously.** `isTournament` and
  `tournamentId` come from the page's own table read. A bust in the first
  seconds after opening or reloading the table found them still unset, so the
  exit was not recognised as a tournament bust. Worse, the seat read then took
  the latched exit for a cash leave from another device
  (`presentRemoteSeatExit`): a cash session summary and the club lobby, over
  the offer the player was owed.
- **A lost exit.** If the `seat_left` is lost with the link, the reconnected
  page finds the seat gone with no reason and nothing offered the rebuy.

## Fix (client, `src/pages/TablePage.tsx`)

- The engine's tournament bust exit no longer closes the rebuy offer. Every
  other exit (leave, eviction, a move) still does.
- The exit is recorded as a bust signal for this player
  (`tournamentBustExit`), bound to the tournament when the page knows it. The
  engine sends this reason only for a tournament seat
  (`ServerTableEngineDealing`), so the reason itself is the signal; the
  watcher acts only once the table is known to be that tournament, consumes
  the signal once, and goes through the unchanged path: the bust hold,
  `canRebuy` (status, zero stack, open window, finalized pool), the price, the
  offer, or the elimination route when no rebuy is allowed.
- A bust exit that arrives after a paid rebuy and before the restored stack
  shows (`rebuyJustSucceededRef`) belongs to the episode just paid for; it
  neither unseats the player again nor reopens an offer.
- The bust exit is never a remote cash leave and never gets the cash
  "removed from table" notice, whatever the page knows of the table yet.
- The seat read offers a seat that vanished with no reason (or after an
  earlier bust) to the watcher, except at a table known to be a cash game;
  `canRebuy` decides, so a moved or still funded player is refused and sees
  nothing. In production the `table_seats` realtime change runs that read
  within 200 ms; the ten-second poll is the backstop.

No engine, schema, chip or seat change.

## Pinned

- `tests/a-rebuy-is-taking-a-seat-again.law.test.ts`: the bust exit leaves the
  offer open, including before the table's kind has loaded; every other exit
  still closes it.
- `tests/unit/expiredSeatClears.test.ts`: the seat read tells the watcher about
  a reasonless vanished seat, and not about a named removal or a known cash
  table.
- `tests/live-turn/tournament-rebuy-hero-cards.pw.ts` (simulated browser, no
  chips, no real player): bust in each order (exit while loading with the
  price read held 1.5 s, exit first, exit after the offer), a dropped link
  after the exit, an exit lost with the link, an expired window (eligibility
  read, no offer, no purchase, no cards), and a stale bust exit after paying
  (no second offer, cards shown).

Results on the final build: Chromium 40/40 (suite x4), WebKit 30/30 (suite
x3). The client before this change fails the five new cases (the expired case
because its bust is never noticed, so eligibility is never read) and passes
the original five.
