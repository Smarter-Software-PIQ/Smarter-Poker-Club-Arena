# Rule 4 reads the price (2026-11-01)

Follow-up to #9065 ("no hold'em 4-bet is ever made to fold"). Dan asked that
its "a 4-bettor always calls a 5-bet" be rechecked before activation and
reconciled with stack depth, sizing, pot odds and tournament context.

## Why #9065 needed it

#9065 made every horse that 4-bet call any 5-bet at any depth. Against a
solver-style 5-bet jam range (AA, KK, some QQ, AK, A5s/A4s) QQ has about 44%
equity. Facing a jam for effective stack S after a 4-bet to F with D dead
chips, a call needs (S - F) / (D + 2S):

| spot | needs | QQ (0.44) |
|---|---|---|
| Saturday Mystery hand 53158209, 107bb, 4-bet to 25bb, tournament (+0.03) | 0.41 | call (correct) |
| 100bb cash, 4-bet to 20.7bb | 0.39 | call |
| 200bb cash | 0.447 | losing call |
| 250bb cash | 0.455 | losing call |
| 160bb tournament (+0.03) | about 0.45 | losing call |

So #9065 fixed the 107bb hand but traded the old leak for a new one deep.

## What changes

`fourBetCommits` in `HorseHoldemPremiumAggression.ts` prices the jam a
re-raise invites. Equity by hand: AA 0.85, KK 0.65, AKs 0.45, QQ 0.44,
AKo 0.43, JJ 0.42, TT 0.40, else 0.35; tournaments add 0.03; a raiser read
as a maniac (public play) adds 0.10 to the hand's equity.

- **4a** keeps "no 4-bet below QQ+/AK" and adds: QQ/AK whose 4-bet could not
  call the jam it invites **flat the 3-bet** (`premium_flat_deep_three_bet`).
- **Rule 2** no longer turns that flat back into a 4-bet at those depths.
- **4b**: a 4-bettor facing a re-raise calls when the price allows. With 4a,
  that is every 4-bet it made, unless the re-raise comes from a deeper stack
  than the one it 4-bet into (for example a third player's cold 5-bet).
  AA/KK still jam through rule 2 at any depth.

Over a 9bb 3-bet that lets QQ 4-bet and call off to about 178bb in cash and
120bb in a tournament, AKo to about 152bb / 108bb and AKs to about 214bb /
136bb. Deeper, they flat.

**Departure from the literal requests, and why.** Dan's 2026-10-25 rule 2
says QQ/AK re-raise a 3-bet and never flat. At the depths above, the only
re-raise they could make is a 4-bet they would then have to fold to a jam,
which is exactly what Dan's 2026-10-31 instruction forbids. There, flatting
is the line that satisfies "STOP 4 BETTING POTS IF THEY ARE FOLDING" without
calling off a stack at a losing price. AA/KK are unchanged.

The range is opponent-blind (CLAUDE.md 10.5).

## Tests

`HorseHoldemPremiumAggression.law.test.ts`: the recorded hand still calls
(QQ, AK, JJ; A5s, at 0.35, folds); 100bb cash 4-bet/call; 200bb and 250bb
cash QQ/AKo flat and rule 2 leaves the flat; AKs keeps its 4-bet at 200bb
(0.45 against 0.447) and flats at 250bb; AA/KK keep the 4-bet; 100bb
tournament 4-bet against 160bb flat; a covered 4-bettor calls a deeper jam at
its own price; the real brain at 200bb never 4-bets QQ, AK, JJ or A5s, and
its receipts stay valid. Related server suites: 55 files, 1,276 tests pass.
