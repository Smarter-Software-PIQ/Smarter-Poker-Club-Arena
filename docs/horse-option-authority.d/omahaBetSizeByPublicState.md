# omahaBetSizeByPublicState: authority for the live switch

PLO Strategy lane, 2026-11-16. Evidence NOT MET for value; a live read is owed after a release.

## What it does

In PLO4/PLO5 cash (pot limit, high only, one board, not Lightning, not a bomb pot), the size of the Horse's own postflop bet or raise is chosen by `horsePublicBetSize.ts` from public information only: street, board class (dry, wet, flush, paired), pot, the seat's chips, the legal bounds, number of opponents, position, and heads-up the opponent's measured fold-to-bet read; one draw from a random stream of its own picks the fixed mix (20% a quarter smaller, 65% the base size, 15% 30% larger). It runs as the last step of the wager_rules node, after every owner rule has decided bet or check, so value hands and bluffs in the same public spot draw from the same size distribution. It never turns a check into a bet, a call into a raise, or a wager into anything else; a check, call, fold or all-in is untouched; where the public size would commit 60% or more of the seat's chips, every betting hand wagers the largest legal amount (the pot-limit cap, or every chip, which the legalizer makes an all-in); with `omahaNutClassValueSize` on, a nut-class wager keeps that option's size.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaBetSizeByPublicState docs/horse-option-authority.d/omahaBetSizeByPublicState.md sha256 <digest>`). The option is registered in the live switch (on and off; follow-up list migration 20261117181040 names it) and is OFF unless such a row is written. The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15: "HE GETS THEM TO FOLD WHEN HE WANTS A FOLD, AND GETS A CALL WHEN HE WANTS A CALL"
- 2026-11-15 12:16 (the timing tell order; this is its bet-size half): the lane's recorded finding "Horse bet size and timing are tells".

## Recorded hands and rulings it answers

sizing-20261116/MEASURE.md: every human-seated PLO4/PLO5 cash hand of 2026-11-10 21:30Z to 2026-11-15 17:33Z (4,573 hands, 3,241 Horse postflop bets and raises with the Horse's cards). The size carried 0.15 of the hand class's 2.11 bits (7%), and 0.13 bits beyond chance inside the same public spot (street, spot, heads-up, position, board texture, stack-to-pot band; permutation p = 0.003). Flop bets of 71-90% of the pot were weak or a draw 47-66% of the time; 31-70% were nut-class 39-61%; river bets of 91%+ were the nuts 90% of the time.

## Receipts

omaha_public_bet_size_applied, omaha_public_bet_size_committed, omaha_public_bet_size_unchanged, omaha_public_bet_size_nut_class_kept, omaha_public_bet_size_illegal_kept (HorseDataLedger.ts).

## Tests

HorseBetSizeByPublicState.test.ts (all pass; 200 private hands on two recorded public states give one size per public draw and one size distribution; the action equals the option-off action; unset, false and truthy non-boolean are byte-identical; no illegal size on 2,000 random public spots), aBetSizeIsPublicInformationOnly.law.test.ts (the size function and its spot take no private input).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest, plo4/plo5 x dev/horse, 150 pairs, seed 5560001, on e7e5f5dbc28: b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1, the same four cells unset and false; sizing-20261116/fp-unset.json, fp-false.json).
- Chips: MET (does not cost chips). League check sizing-20261116/PROTOCOL.md on e7e5f5dbc28: 6 seats, 100 bb, hybrid baseline, the day's 32 live options at every seat, 3 seeds (5590001-3) x 4,000 mirrored pairs per game, option on (3 seats) over off (3 seats). PLO4 +0.34 bb/100, SE 1.07, band [-1.80, +2.48] (seeds +0.08 / +0.00 / +0.94); PLO5 -0.72 bb/100, SE 1.09, band [-2.90, +1.46] (seeds +4.05 / -2.94 / -3.25). Neither loses beyond 2 SE; 918-1,010 of 4,000 pairs diverge per run; 0 illegal, 0 truncated, 0 fallbacks. The league's opponents do not read bet sizes, so this shows only that the public sizes do not cost chips against Horses; it cannot show the tell is closed against people. (A first run on b6f1786e15b was void: the option was inert in the league, fixed in e7e5f5dbc28.)
- Value against humans, reach: NOT MET; a live read is owed.

## Limits

Every size constant is a builder's choice, NOT MEASURED. The engine's own all-ins, preflop, hi-lo, PLO6 outside the PLO6 scope, tournaments and multi-board hands keep today's sizes. The bet-or-check decision itself still depends on the private hand (by design): how often a Horse bets in a spot still carries information, only the size no longer does.
