# The Hold'em Persona Reaches Three Postflop Mixes (Default Off)

Persona promises P17 and P21 (postflop half). A new option, `holdemPersonaPostflop`, OFF by default.

## What Was Missing

- P17: the out-of-position check-raise trap used one fleet mix (0.42) and never read the persona's trap frequency.
- P21: the Nit Hunter was a label only; nothing made it stab capped checked ranges more than any other Horse.
- The heads-up dry-flop range continuation bet was one frequency for all four archetypes.

## What Changed

With the option on, in two-card no-limit hold'em only:

1. The flop check-trap and the flop check-raise into a stabber use the Horse's own trap frequency (fleet mean kept at 0.42, at most 0.72). A Tricky Trap traps most, a Nit Hunter and a LAG least.
2. The turn takeaway (a stab after the opponent checks the turn) is scaled by archetype: Nit Hunter 1.30, LAG 1.00, TAG 0.9375, Tricky 0.90.
3. The range continuation bet is scaled by archetype: LAG 1.12, TAG 1.00, Tricky 0.94, Nit Hunter 0.88.

Each scale averages 1 across the fleet, so the fleet's overall frequencies stay where they are. The two bluffing scales are never above 1 against a player the Horses read as tight. No new random draw is taken, so with the option off every decision is exactly what it was.

## Not Built

- P5 archetype VPIP bands and P7 six-seat fleet VPIP are opening-range changes and stay with `holdemPersonaPreflop` (owner preflop range hold).
- P13 persona reshoves: removed by the owner's ruling (reshoves are not persona-specific).
- P10 and P11 (early-position limp-trap mix, Tricky limp-reraise): their only build, #10570, was closed unmerged; they change preflop limp ranges and are not in this head.
- P22 (persona-linked top-up) is seating, not a decision.
- The loose-opener half of P21 is in `holdemPersonaPreflop`.

## Tests

`HorseHoldemPersonaPostflop.test.ts`: the tables' fleet mean, the trap bound and mean over 4,000 ids, archetype ordering, the tight guard, and off equals absent seed for seed.
