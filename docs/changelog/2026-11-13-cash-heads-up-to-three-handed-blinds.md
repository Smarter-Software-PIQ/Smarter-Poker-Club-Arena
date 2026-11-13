# Cash, heads-up back to three-handed: nobody posts the small blind twice running (HU-EXE-002)

Date: 2026-11-13

## Defect

Heads-up the button is the small blind. When a third player was dealt into a
heads-up cash game, the button walked forward onto the player who had just
posted the big blind. That player skipped the small blind, and the previous
button posted the small blind twice running. Half a big blind moved from one
incumbent to the other at every such transition. Reproduced through the real
table engine on all 32 seat layouts of two incumbents and one newcomer (main
`4c351cfc`). Tournaments were already correct (`deadButton.ts`), and so was
three-handed down to heads-up (`headsUpButton.ts`).

Example, seats 1 and 2 heads-up, a newcomer at seat 3:

    before  hand 2  button 2  small blind 2  big blind 1
            hand 3  button 1  small blind 2  big blind 3   (seat 2 pays the small blind again)

## Fix

`ServerTableEngineBase.cashButtonStaysAfterHeadsUp`: for the one entry hand
after a heads-up hand the cash button stays where it was, so the previous big
blind posts the small blind and the big blind advances one seat. The deal and
the big-blind predictor (the wait-for-big-blind gate) use the same helper, so
they cannot disagree. Nobody posts the big blind twice; the newcomer still
enters in the big blind and never on the button or small blind.

Known effects: a newcomer seated between the button and the big blind waits
one more heads-up hand (entry within two hands). After a heads-up bomb pot,
which records no blinds, the previous walk is used.

The table rules text gains one sentence saying so.

## Tests

`server/src/engine/CashHeadsUpToThreeHandedBlinds.law.test.ts`: 32 layouts,
fails 32 of 32 before the fix, passes after.
