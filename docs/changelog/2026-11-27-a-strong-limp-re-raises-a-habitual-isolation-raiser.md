# A Strong Limp Re-Raises A Habitual Isolation Raiser (omahaLimpReraiseVsIsoRaiser, Default Off)

## What was found

Since `vpipFloorLimpFoldsToARaise` went on (the owner's ruling: a VPIP-floor limp folds to any raise), nearly every Horse limp folds to a raise, so a zero-equity isolation raise over a Horse limp, answered only by Horses, profits: PLO5 tables +0.42 +/- 0.18 bb per raise (n 734) and +1.26 +/- 0.36 (n 175) in two eras (lane OFD, public actions). People isolate a limp 65.5% of the time in PLO5 (1,137 chances) and fold to a 3-bet 0 times in 786.

## What changed

- Owner order 2026-11-27 12:48 PM Chicago: "limp re-raises in position ... or with a connected rundown hand".
- `omahaLimpReraiseVsIsoRaiser` (default OFF, read `=== true`), PLO4/PLO5 cash, preflop (`HorseOmahaLimpReraise.ts`):
  1. First in, at most two players behind, a strong hand (top 20% by the engine's preflop percentile, not trips or trash) the brain raises becomes the limp with probability 0.5 (deterministic on its own cards) when EV(limp, then the pot re-raise of his pot isolation) clears EV(open) by the deadband plus the sampling error. The raiser is the player behind with the highest raise-when-unraised rate from his own decayed record (exploit counters rfi / rfiOpp) shrunk to the people-only prior; his fold to a re-raise from his own record against the people prior. Only in position against him after the flop, or with a connected rundown.
  2. The Horse's own limp (never the VPIP floor's: every floor step runs first and a hand marked `ownVpipFloorLimpThisHand` is never touched), raised once heads-up, with a strong hand, in position or with a rundown, becomes the pot re-raise when EV(re-raise) > max(EV(call), 0) + deadband + sampling error.
- No identity key, no named player, no unshown card. Off: byte-identical.
