# Horses Can Steal From Tight Blinds (Built In, Held Off)

The blind steal against tight players was removed earlier today as a half-built stub (Hand Analysis B2). It is now built in full behind the option `styleStealTightBlinds`, default OFF. The live switch holds every steal option off-only under the owner's blind-steal hold, so this cannot be switched on until that hold is lifted by name.

## What It Does

In no-limit hold'em, when the action is folded to a Horse in the cutoff, on the button or in the small blind, and every player left to act is one the Horses have measured as tight and not aggressive, the Horse opens a few more hands. The bar moves by half of the fold-equity surplus over the open's break-even, never by more than 0.06.

It stands down at push/fold depths, in All-In-Or-Fold, bomb pots, bounty events and Omaha, and whenever anyone left to act is unknown, loose, a maniac, value-heavy or attacking.

## Assumptions

A blind is assumed to defend about twice as often as his overall VPIP, and the open is priced at 2.5 big blinds. Neither is measured yet.

## Tests

`aTightPlayersBlindsAreStolen.test.ts`: more opens against two tight blinds; identical decisions and random stream against every control, from the cutoff with an unknown button, at 20 big blinds, and with the option off.
