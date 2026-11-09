# The limp-reraise read (2026-11-07)

## What was found

The exploiter suite (`hx_limp_reraise`, `ExploiterLeague.ts`) plays a horse
that limps the unopened pots it would have raised (plus its top half) and
re-raises 4x after a horse isolates (its top 12% and a random 15%). Against
production horses it took +18.6 +/- 8.7 bb/100 at six-handed 40bb. Limping
alone earned nothing; the re-raise did. The button isolated 39.5% of hands over
an under-the-gun limp and folded 69% of that to the re-raise. Defending the
re-raise like a 3-bet (`vsLimpReraiseDefence`) did not help: the extra calls
were lost later.

## The fix: `limpReraiseIsoRead` (default ON)

`HorseMind` counts, per player, the times a preflop limp met a raise behind it
and the action came back to the limper (`OpponentStats.lrOpps`), and how many
of those answers were re-raises (`lrRaises`). Pooled and memory only, like the
probe tallies; carried by the mind mirror and in read frames
(`horse-decision-reads-v12`, admitted by the journal), so a second look reads
the limper exactly as the first did.

`HorseLimpReraiseRead.ts`: the rate is shrunk toward a 5% population rate with
10 pseudo-observations, so one or two re-raises move nothing. Against limpers
whose strongest shrunk rate is above 12%, the no-limit hold'em isolation bar
rises toward 0.58 strength, fully at 30%, and the V10 isolation widen is
withdrawn against them. At 0.58 the button over an under-the-gun limp
(six-handed 40bb cash, live persona) isolates 12% of hands instead of 38%,
about the hands a horse continues with against a 4x re-raise. Hands below the
bar limp behind or fold as they do today. Nothing changes against a player who
has not been seen to limp-raise.

## The commitment rule: `commitUnderPot` (default OFF)

The brain already has a commitment rule: the postflop committed branch
(stack-to-pot under 1.2) prices a call at the pot odds plus a small premium,
so it folds only when the hand's equity is below the price. The literal rule
("never fold the flop or turn with less than a pot behind") was built behind
`commitUnderPot` (`HorseLogic.commitUnderPotCall`: heads-up, no-limit hold'em,
flop or turn, facing a bet, remaining stack smaller than the pot including the
bet: call, all in when the call is the stack) and measured. It helps against
the exploiter but loses against every other field, so it stays off.

## League

Exploiter (`ab.mts` in the evidence folder: the exploiter's policy in seat 0
under both arms, the same deals, each arm with its own memory sandbox; horses'
gain = flag on minus off, bb/100, 8,000 pairs per seed):

| arm                | format     | seed 11        | seed 22        | seed 33        | seed 44        | pooled            |
| ------------------ | ---------- | -------------- | -------------- | -------------- | -------------- | ----------------- |
| limpReraiseIsoRead | 6-max 40bb | +12.6 +/- 6.4  | +9.1 +/- 5.5   | +10.1 +/- 5.8  | +17.6 +/- 5.9  | **+12.3 +/- 3.0** |
| limpReraiseIsoRead | 6-max 80bb | +23.5 +/- 10.3 | +4.8 +/- 9.0   | +11.3 +/- 9.6  | +9.6 +/- 9.5   | **+12.3 +/- 4.8** |
| commitUnderPot     | 6-max 40bb | +5.6 +/- 5.3   | +7.9 +/- 4.2   | +11.3 +/- 5.4  | +2.5 +/- 4.4   | **+6.8 +/- 2.4**  |
| commitUnderPot     | 6-max 80bb | +9.3 +/- 9.0   | +4.6 +/- 7.7   | +15.8 +/- 9.0  | +11.8 +/- 7.9  | **+10.4 +/- 4.2** |
| both               | 6-max 40bb | +20.4 +/- 7.1  | +23.5 +/- 6.0  | +17.1 +/- 6.9  | +25.0 +/- 6.5  | **+21.5 +/- 3.3** |
| both               | 6-max 80bb | +33.5 +/- 11.6 | +20.7 +/- 10.1 | +17.1 +/- 11.1 | +22.1 +/- 11.0 | **+23.4 +/- 5.5** |

The exploiter's own edge over a horse in its seat (`exploiterLeague.ts`,
8,000 pairs), read off and on:

| format     | seed     | off            | on             |
| ---------- | -------- | -------------- | -------------- |
| 6-max 40bb | 11       | +1.0 +/- 8.1   | -11.7 +/- 7.4  |
| 6-max 40bb | 22       | +14.0 +/- 7.4  | +4.9 +/- 7.1   |
| 6-max 40bb | 33       | +17.5 +/- 7.9  | +7.4 +/- 7.5   |
| 6-max 40bb | 20261108 | +17.4 +/- 8.1  | +5.4 +/- 7.5   |
| 6-max 80bb | 11       | +0.6 +/- 11.5  | -22.4 +/- 10.4 |
| 6-max 80bb | 22       | +9.7 +/- 10.0  | +4.9 +/- 9.4   |
| 6-max 80bb | 33       | +19.0 +/- 11.4 | +7.7 +/- 10.5  |
| 6-max 80bb | 20261108 | +11.9 +/- 11.5 | -7.8 +/- 10.1  |

Pooled, the exploiter's edge falls from about +12.5 to +1.5 bb/100 at 40bb and
from about +10 to -4 at 80bb; with the read on it is no longer significant on
any seed.

Mirror (every seat a production Hybrid horse, arms swapped) and the
human-calibrated field (six-handed only), two seeds x 20,000 pairs, flag on
minus off, bb/100:

| card                   | limpReraiseIsoRead | commitUnderPot (1107 / 2207)    |
| ---------------------- | ------------------ | ------------------------------- |
| mirror cash 6-max 40bb | inert              | -2.59 +/- 0.50 / -2.05 +/- 0.52 |
| mirror cash 6-max 80bb | inert              | -1.72 +/- 0.63 / -1.14 +/- 0.58 |
| mirror cash 9-max 40bb | inert              | -1.68 +/- 0.34 / -1.74 +/- 0.34 |
| mirror cash 9-max 80bb | inert              | -1.69 +/- 0.43 / -0.71 +/- 0.44 |
| mirror MTT 6-max 40bb  | inert              | -2.94 +/- 0.58 / -3.25 +/- 0.60 |
| mirror MTT 6-max 80bb  | inert              | -2.78 +/- 0.72 / -0.96 +/- 0.67 |
| mirror MTT 9-max 40bb  | inert              | -2.69 +/- 0.40 / -2.13 +/- 0.42 |
| mirror MTT 9-max 80bb  | inert              | -1.98 +/- 0.51 / -1.84 +/- 0.54 |
| human cash 6-max 40bb  | inert              | -5.88 +/- 1.14 / -4.46 +/- 1.16 |
| human cash 6-max 80bb  | inert              | -5.58 +/- 1.90 / -1.67 +/- 1.88 |
| human MTT 6-max 40bb   | inert              | -6.17 +/- 1.10 / -4.39 +/- 1.17 |
| human MTT 6-max 80bb   | inert              | -4.90 +/- 1.60 / -2.12 +/- 1.75 |

(MTT: big-blind ante, 180 left of 300, 30 paid.)

Owner rule (claim only |bb/100| > 2 stderr; ON only with a significant
positive and no significant negative): `limpReraiseIsoRead` is significantly
positive against the exploiter at both depths and inert everywhere else (no
horse and no human-field player limp-reraises often enough to engage it), so
it ships ON. `commitUnderPot` is significantly negative on most mirror and
human cards, so it stays OFF.

Tests: `HorseLimpReraiseRead.test.ts` (the counting, the shrinkage, the
isolation share through the whole brain against a seen limp-reraiser, a
limper never seen to limp-reraise and an unknown limper, default ON, the
commit rule's scope, the v12 frame round trip).
