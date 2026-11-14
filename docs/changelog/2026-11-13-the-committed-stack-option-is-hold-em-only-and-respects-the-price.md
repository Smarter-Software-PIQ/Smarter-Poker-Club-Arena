# The Committed Stack Option Is Hold'em Only And Respects The Price (Still Off)

Follow-up to the independent review of 2026-11-13 (findings A1, A3, A4 and A5) of the option `committedStackPricedIn`. The option lets a tournament Horse that is already heavily committed call a multiway all-in instead of folding. It is still OFF by default, nothing in production can switch it on, and this change does not switch it on. With the option off or absent every decision is the same as before.

## What Changed

All of it is inside the priced-in guard in `server/src/engine/HorsePreflop.ts` and only matters with the option on.

1. Hold'em only. The rule now applies to two-card no-limit hold'em and nowhere else. In Omaha (four, five and six cards), Short Deck, Pineapple and fixed limit the hand strength is measured on a different scale and no study covers the call, so those games decide exactly as they do with the option off.
2. The tiny-stack case respects the price. With 2 big blinds or fewer behind, the rule used to ask for a hand that clears 0.26 at any price. That folded hands that had the odds. Now, three-handed, a price of 12 percent or better is called with any two cards; above that price the 0.26 floor still applies. With three or more opponents in the hand the floor applies at every price.
3. The description of the option in the Horse data ledger now states the rule as it is written.

4. The any-two call is chip arithmetic only (second review, finding H1). On the bubble a fold cashes whenever another all-in loses, so the chip price is not the whole price. When a pay jump is live (hand for hand, near the bubble, within 15 percent of the paid places, already in the money, a satellite, or a payout context that is missing) the any-two call stands aside and the 0.26 floor decides, exactly as before this change.

## The Arithmetic

Price is the call divided by the pot after calling. When the call ends the hand, calling is right when the hand wins at least that often.

- Three ways against two tight ranges (tens or better, ace-queen suited or better, ace-king), the worst two cards win about 12 percent of the time (king-deuce offsuit, 12.1 to 12.5 percent across runs) and seven-deuce wins 13.3 percent. So at a price of 12 percent or better no hand calls below its price.
- Example: big blind with a big blind ante and half a big blind behind, small blind folded, two bigger stacks all in. The pot before the call is 5.5 big blinds, the price is 0.5 / 6.0 = 8.3 percent. Seven-deuce is worth 0.133 x 6.0 = 0.80 big blinds by calling and 0.5 by folding, and that 0.5 goes in as the small blind next hand anyway.
- Four ways the same cards win less often than the price can be (king-deuce 7.9 percent, seven-deuce 11.6 percent, against a price of 10.5 percent for a big blind with 1 big blind behind), which is why the any-two price is read three-handed only.

## Proof

Added to `server/src/engine/ACommittedStackIsNotFoldedAtAPrice.law.test.ts`:

- Big blind with 0.5 big blinds behind at 8.3 percent: seven-deuce, three-deuce, king-deuce and five-four call with the option on and fold with it off or absent. At 0.8 big blinds (11.6 percent) seven-deuce still calls. At 1 big blind (13.3 percent, just above the price) all four fold. Four ways at 6.7 percent they fold.
- Boundary of the 0.26 floor: three hands under it and three over it by more than the 0.03 strength jitter, so no seed can flip them, and one hand exactly on it that is checked to decide the same way twice on every seed.
- PLO4, PLO5, PLO6, Short Deck and Pineapple tournament spots the rule would otherwise rescue: option on equals option absent on every seed, and the counter never fires.

## Limits

- The equity figures are Monte Carlo runs against stated ranges, not solver output.
- The rule as it now stands has no league measurement. The one existing league seed predates both the 0.26 floor and the price rule.
- By default the non-hold'em all-in arithmetic decides those spots before this guard is asked, so the variant tests also run with that arithmetic switched off, which is the route on which the guard decides.
- Nothing changes in play. The option stays off until the owner decides otherwise.

## Third review (347b0afc): no call that can bust the Horse while a pay jump is live

The option is still off. Three more cases now stand aside, so that when the option is on and a pay jump is live it
never makes a call that can bust the Horse:

1. One off the money in a small field. Four players left with three paid is 1.33 times the paid places, over the old
   15 percent line, and it is the bubble. The check now uses the tournament feed's own near-bubble line.
2. Every satellite is treated as live, whatever its seat count says: a seat is the whole prize.
3. A hand over the 0.26 floor with crumbs behind, a call for the rest of the stack with half the stack already in, and
   the 0.18 all-in price are decided as with the option off while a pay jump is live. A call that leaves chips behind
   (the recorded A7o hand, where the Horse covers) is unchanged: it cannot cost a pay jump.

Far from the money nothing changes. The token price (0.05 or better) is read as before.
