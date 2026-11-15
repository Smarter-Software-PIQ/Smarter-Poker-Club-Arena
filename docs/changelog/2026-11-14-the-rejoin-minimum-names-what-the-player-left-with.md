# The rejoin minimum names what the player left with

2026-11-14. Dan, about a player who could not sit: "I think the issue is that
he is trying to buy in for less than he left the table with. And if so, it
should say that specifically, not whatever this pop up message was."

That was not what stopped that player (he left with 20.87 and asked for 25; see
`2026-11-14-the-cash-buy-in-never-waits-on-the-disk.md`). The instruction
stands on its own, and Dan confirmed it the same evening.

## Before

A player returning inside the rejoin window must bring back at least the stack
he left with. The buy-in sheet raised its Min and said nothing about why, and a
refusal read "The Minimum Buy In For This Game Right Now Is N". OPORD 1.3
section 6.1 had asked for exactly that: a number, no reason.

## Now

- The buy-in sheet prints "You Left This Game With N. Your Minimum Buy In Is
  N." under the amount. It appears only when `fn_cash_effective_buyin` answers
  `floor_applied`, which is the server saying the rejoin floor is what raised
  the minimum.
- The door's refusal reads "You Left This Game With N. Your Buy In Must Be At
  Least N." when the number it quotes is that same floor. `BUYIN_BELOW_FLOOR`
  is also raised for the ordinary table minimum; without the server's word that
  the floor applied, the message stays a number.

The forbidden words of A0.14 are still forbidden. The pin in
`tests/chip-continuity-is-house-law.law.test.ts` moved with the ruling, in this
commit. Client only.
