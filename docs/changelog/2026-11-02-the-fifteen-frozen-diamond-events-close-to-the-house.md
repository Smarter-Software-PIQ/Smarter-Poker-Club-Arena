# The fifteen frozen Diamond events close, and their Diamonds go to the house

Date: 2026-11-02. Migration: `20261102150315_the_fifteen_frozen_diamond_events_close_and_their_diamonds_g.sql`.

## The instruction

Dan, 14:53 UTC: "MARK THEM ALL AS COMPLETED, AND MOVE THE DIAMONDS INTO THE MINT. I DON'T WANT THESE MARKED AS OUTSTANDING OR STILL RUNNING AGAIN."

This replaces the equal-share plan for these events (20261101004247). None of the remaining entrants receives a share.

## What was held

- 15 RUNNING Diamond events, stopped since 2026-10-31 03:30:49 UTC.
- 1,436 registrations, 704 of them still playing.
- 1,436 unreleased entry custody rows holding 428,212 Diamonds:
  - prize bank: 380,070
  - bounty bank: 22,500
  - fee bank: 25,642
- 8,990 Diamonds were already awarded before the closure. They are untouched.

## What happens

1. The prize and bounty banks (402,570) are drained to the house through `fn_poker_diamond_tournament_drain`. Each entry's purchased lots are consumed and one release movement is written per row. The register burns each entry and mints the same amount to the house (`ca_diamond_house`). The Diamond ledger records one `forfeit` outflow row per event.
2. The fee bank (25,642) goes to the house through `fn_settle_tournament_rake`, then `fn_poker_diamond_tournament_settle_fee`, and the emptied custody rows are released.
3. Each event is then closed:
   - the escrow is closed at exactly zero;
   - the roster is retired, keeping the original places and elimination order;
   - the seats are released and the tables closed;
   - the event is set to CANCELLED;
   - an immutable `receipt_version` 5 receipt (`started_owner_forfeit_to_house`) is written, and `smarter_private.tournament_owner_forfeit_receipt` proves it at commit.

The migration asserts every event's banks before it touches them, so it aborts if anything moved since it was written. It also asserts the totals: 15 events, a 402,570 forfeit, a 25,642 fee, and +428,212 to the house.

## Why CANCELLED and not COMPLETED

COMPLETED needs a canonical winner, a finish claim and a financial certificate. None of these events finished, and making up a winner would fabricate a result. CANCELLED is the terminal status every operator closure uses.

The lobby lists only REGISTERING, RUNNING and BAGGED events, so these no longer appear anywhere as live. No rows are deleted: they are the audit trail of 428,212 Diamonds.

## Schema added

- Ledger kind `forfeit`. The Diamond escrow and the terminal shadow count it out of each bank.
- The drain labels a forfeit honestly in the register.
- Receipt version 5, with the same zero-refund and zero-reversal arithmetic as version 4, plus its validator.
- No standing function that can forfeit an event. The forfeit runs once, inline, for exactly these fifteen ids.

## Coordination

The equal-share operations for these events never quiesced: 7 targets were `stop_requested` and 8 had no target. So there is no earlier settlement write to duplicate. Once the receipt exists, the event's evidence is immutable, so the equal-share door cannot run afterwards.
