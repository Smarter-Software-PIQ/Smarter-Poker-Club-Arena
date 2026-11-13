# A Committed Tournament Stack Is Not Folded At A Small Price (Default Off)

Study leads HVH2D-NLH-M-COMMIT and HVH2D-NLH-007a (two-day Human vs Horse study, 2026-11-12).

## What Was Wrong

In tournaments a Horse sometimes put most of its stack in before the flop and then folded for a tiny extra amount. The plainest case: 31 chips to call into a pot of 6,062, with 63 percent of the stack already in. Six such folds were in the study, at prices from half a percent to 19 percent.

All six happen in the same kind of spot: one opponent is all in and another player has called or raised. The code names that spot a multiway all-in. The part of the Horse that decides it looks only at how strong the hand is. It does not look at how many chips the Horse already has in the pot, or at how cheap the call is.

A separate safety rule (the priced-in guard) exists to stop exactly this kind of fold: when the call is cheap enough against the pot, it calls. That rule stood aside for every multiway all-in, with the stated reason that "call with any two cards" is not safe against several strong hands. That reason is right for a fresh decision. It is wrong once the Horse is already committed.

## What Changed

Everything below sits behind a new option, `committedStackPricedIn`, which is OFF by default. With it off (absent or false) the guard is exactly the one it replaced: the test checks that the decision is identical, field for field, on all six spots and twelve seeds. Turning it on is a separate owner decision. A counter, `committed_stack_priced_in_seen`, fires each time the option turns one of these folds into a call.

One place in `server/src/engine/HorsePreflop.ts` (the priced-in guard in `decidePreflopV7`). In a tournament multiway all-in the guard now decides again in three cases:

1. The price is 5 percent or better (19 to 1). No hand is that far behind.
2. Two big blinds or fewer remain behind. This is the guard's own existing line for a stack that small.
3. Half or more of the stack the Horse started the hand with is already in, and the hand is not junk (it clears 0.26, the guard's existing tournament floor for a priced-in call when someone else has called).

One bounded extension for finding 007a (queen-jack suited, 56 percent of the stack in, price 15.9 percent, just above the guard's 15 percent line): a committed Horse whose call puts in the rest of its stack continues with a top-half hand up to a price of 18 percent. Once the call is all in there is no later bet to face, so the only question is whether the hand wins often enough for the price. Queen-jack suited wins about 16 percent of the time even against aces and kings together, and 22 to 30 percent against the hands that really take this line.

The tournament utility arbiter still runs afterwards and still turns the call back into a fold when it is confident. It was not changed.

## What It Does On The Six Spots

Before (and with the option off), all six fold on every seed. With the option on and the prize pool priced correctly:

| Spot                                    | Stack in          | Price | Before | After       |
| --------------------------------------- | ----------------- | ----- | ------ | ----------- |
| 33, button                              | 69%               | 11.0% | fold   | call all in |
| 77, big blind, 1.8 big blinds behind    | 52% with the ante | 19.2% | fold   | call all in |
| A8s, 31 chips into 6,062                | 63%               | 0.5%  | fold   | call        |
| A7o, hand-for-hand bubble, Horse covers | 55%               | 12.2% | fold   | call        |
| QJs, hijack (007a)                      | 56%               | 15.9% | fold   | call all in |
| J8o, in the money                       | 59%               | 14.4% | fold   | fold        |

J8o is left folding on purpose. It is a junk hand, three ways it barely clears the price in raw equity, and the arbiter's own estimate rates the fold higher there. The study did not show that fold to be a mistake.

## What It Does Not Do

- Cash games are unchanged. The changed lines need a tournament multiway all-in.
- A Horse that is not committed still folds as before. The same A7o spot with a deep stack behind still folds.
- No random draw was added, removed or moved.
- The first call in several of these hands may have been the bigger mistake. That is a separate question and was not touched.

## Proof And Limits

- New law test `server/src/engine/ACommittedStackIsNotFoldedAtAPrice.law.test.ts` (registered in `docs/laws.d/`): the six spots with the option on, the protected folds (J8o, the deep-stack A7o, junk hands at the 33 and QJs nodes, cash), the arbiter cases, the option off and absent (identical decisions, all six fold), and the counter. It includes the controls above and three spots where the arbiter folds the new call because the pool is mispriced.
- The six spots are reconstructions from public development-packet rows, not replays. Other tables' stacks, the payout table and the level clock are stated assumptions. They show how the code decides a spot of this shape; they cannot prove what the original decision computed.
- League card `mtt6_committed_stack_priced_in_4bb` (six-max big-blind-ante MTT, arm A the option on). Its context carries the live M state; the existing MTT contexts do not, so no existing card can reach the multiway all-in branch. Every seat starts each hand with the same stack, so the half-the-stack case almost never arises in the league: at seed 1107 the same card diverged in 0 of 6,000 pairs at 10bb and 0 of 2,000 at 6bb. At 4bb the big blind's ante leaves it 2bb behind, the rule's crumbs case, and 788 of 2,000 pairs diverged. The card measures that case; it is a standing measurement, not the evidence for the study spots.
- Development evidence only. One league seed (4 big blind card, option on against off) measured +6.58 +/- 0.74 bb/100 before the floor below was added; that run only reaches the 2 big blinds behind case and is not grounds to switch the option on.
- After independent review 461281e7, the 2 big blinds behind case also needs the hand to clear the 0.26 floor, so junk no longer goes in below its three-way equity. The equity figures are a Monte Carlo against stated ranges, and the arbiter's estimates depend on the assumed field.
- Nothing changes in play until the option is turned on, and nothing is live until the next engine release.
- Independent check (2026-11-13, a89093a1): the six spots rebuilt from stored hand facts with the live M state fold 144 of 144 each with the option off. The first independent replay (replay-007) reported five of six continuing only because it left the tournament M state out, which switches Phase 6 off.
