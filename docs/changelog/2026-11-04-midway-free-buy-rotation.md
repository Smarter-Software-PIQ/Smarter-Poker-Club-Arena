# Midway's five daily Free Buys rotate four formats

Owner direction November 4: the Midway union runs five Free Buys a day, in
this order (Chicago time):

- 8:30 AM Morning: regular No-Limit Hold'em with a 250-chip guarantee,
  1-chip rebuys and 1-chip add-ons in the first hour.
- 12:30 PM Midday: the November 2 promo-funded PKO, unchanged.
- 4:30 PM Afternoon: all-in-or-fold with a 500-chip guarantee, 1-chip rebuys
  in the first hour, no add-ons.
- 8:30 PM Prime Time: mystery bounty, no guarantee, 1-chip rebuys and add-ons
  in the first hour.
- 12:30 AM Midnight: the promo PKO again. This slot was removed by the
  November 3 daily-hours rule and is restored as that rule's only exception.

Every entry is free to the player. Midway's promo wallet pays exactly one chip
per registration, human or horse, journaled once per registration. Where that
chip goes depends on the format: in the PKO it is the player's bounty (as
before); in the regular and all-in-or-fold events it goes to the prize pool;
in the mystery event half goes to the mystery bounty pool and half to the
prize pool. Every rebuy and add-on is paid from the player's own wallet with
no fee: all of it goes to the prize pool in the regular and all-in-or-fold
events, all of it to the bounty in the PKO, and half and half in the mystery
event, add-ons included. A player who withdraws or an event that is cancelled
before play returns the promo chip to the promo wallet from the same pools it
went into. Refund records and the independent escrow check use the same split.

The schedule writer still refuses tournament starts outside 6:00 AM to
11:00 PM Chicago, except the Midway union's Midnight Free Buy at 12:30 AM.

The database now shapes an unregistered Midway Free Buy to whichever of the
four formats the engine writes, and holds an event with entrants to the terms
they entered under. The upcoming Morning, Afternoon and Prime Time events that
had no entrants were switched to their new format by this change; Midday and
Midnight stay PKO, and any event that already has an entrant keeps its format.
No wallet balance moves when the change is installed.

The native rehearsal (`scripts/ci/test-midway-free-buy-rotation.py`) installs
this exact change over production's current definitions and checks each
format's entry funding, rebuys, add-ons, withdrawal return, escrow agreement,
frozen registered events and the 12:30 AM exception.

Validation and delivery status are recorded in the owning task checkpoint;
source or passing local tests alone do not establish production installation.
