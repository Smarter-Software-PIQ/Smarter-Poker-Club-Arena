# PLO Suited Aces 4-Bet And Paired-Board River Check

Dan watched the PLO5 1/2 Madness hand 55704472 (06 Nov 2026, about 03:40 UTC) and said: "I JUST WATCHED NOODLE NOT RE RAISE PRE FLOP WITH SUITED ACES, THEN PROCEED TO PAY OFF THE ONLY HUMAN PLAYER WHEN THE BOARD PAIRED", and then: "HE BET BIG ON THE PAIRED BOARD, HUMAN CALLED, THEN FIRED THE RIVER UNIMPROVED."

## The Hand

The horse held Ad Ac Kd 9d 3h with 475 chips. It opened to 8, the button called and the human in the small blind 3-bet the pot to 36. The horse only called. On 4d 5c Jc it called a 42 bet. The 5d paired the board on the turn; the human checked, the horse bet 38 and the human called. The 2s river gave the horse a five-high straight; the human checked, the horse bet 125 into 244 and the human called with fives full of fours.

Every one of these actions came from the ordinary reference brain. No later layer changed any of them (decision journal on the engine host, policy graph of all five decisions).

## Cause One: Suited Aces Could Not 4-Bet

The rule that makes suited aces re-raise (October 23) only reached the spot where the horse faces a single open. Facing a 3-bet, the 4-bet decision compared the hand's general strength score with a fixed bar. A five-card hand with two aces scores about 0.69 there and the bar was about 0.87, so this hand could never 4-bet; it called.

Fix: in pot-limit Omaha high (PLO4, PLO5, PLO6), two aces with an ace suited to another card now 4-bet the pot when facing exactly one 3-bet, as long as the call is no more than a quarter of the horse's stack and the effective stack is no deeper than 250 big blinds. If the horse is then re-raised again, it continues whenever it needs 45 percent equity or less, so it never raises and then folds. Hi-lo games, three aces and unsuited aces are unchanged.

## Cause Two: It Kept Betting The Paired Board Without A Boat

Nothing stopped a hand below a full house from betting the river of a paired board into a player who had already called a bet on that paired board. Over the 24 hours to 03:45 UTC on 06 Nov, horses made 576 such river bets in PLO4/5/6 cash without a full house; when they were called the horse lost far more often than it won in every class (for example PLO5 flushes won 5 of 20 calls, PLO5 two pair 2 of 24, PLO6 0 of 20 across all classes), while full houses won.

Fix: in PLO4, PLO5 and PLO6 (high only, one board), on the river of a board that was already paired on the turn, a horse without a full house whose own turn bet was called now checks instead of betting. Full houses and better still bet. Calls and folds facing a bet are still decided by the paired-board fold rule.

Both rules treat every opponent the same, horse or human.

## Protection

Two complaint laws replay the real hand exactly through today's brain (horseComplaints/plo5-suited-aces-flat-vs-3bet and plo5-paired-board-river-barrel-no-boat), each with a control that switches its rule off and brings the old action back. A boundary test covers unsuited aces, three aces, PLO4 and PLO6, hi-lo, deep stacks, boats, boards that pair only on the river, uncalled or raised turn bets, and facing a river bet.
