# Preflop defence leaks at 20bb: facing an open and facing a 3-bet (2026-11-07)

Options: `facingOpenFullRingZone` and `vs3BetShortStack`, both default OFF
(only explicit `true` turns them on), registered in `HorseDataLedger.ts`.
Found by the preflop audit of 2026-11-07 (report: `agent-evidence/
horse-improvements-01Gw7a/preflop/README.md`).

## Measured (HorseLogic.decide, live Hybrid personas, production charts hydrated, 24 samples per class)

**Facing an open, tournament, 20bb, 1bb big-blind ante** (combo-weighted
share of all hands):

| spot                       | fold | call | raise/jam |
| -------------------------- | ---- | ---- | --------- |
| 6-max BB vs BTN 2.5bb open | 88.6 | 0    | 11.4      |
| 4-max BB vs BTN 2.5bb open | 88.6 | 0    | 11.4      |
| 6-max BB vs UTG 2.5bb open | 90.9 | 0    | 9.1       |
| 9-max BB vs BTN 2.5bb open | 27.4 | 57.0 | 15.6      |

The minimum defence against a 2.5bb open into 1.5bb of blinds and 1bb of
ante is 50%; the horse defends 11%. Cause: `HorsePreflop` puts a stack in
jam-or-fold when the table-scaled M (`stack / orbit x players / 10`) is red
(< 6) up to 22bb, so the same 20bb stack is red six-handed (M 4.8) and
four-handed (M 3.2) but not nine-handed (M 7.2). V82 (2026-11-05) replaced
that gate with the <= 15bb push/fold zone for two- and three-handed tables
only.

**Facing a 3-bet at 20bb** (the opener's open was about 45% of hands):

| spot                               | fold | call | 4-bet/jam |
| ---------------------------------- | ---- | ---- | --------- |
| cash 6-max BTN vs BB 3-bet to 11bb | 98.4 | 0    | 1.6       |
| cash 9-max BTN vs BB 3-bet to 11bb | 98.6 | 0    | 1.4       |
| tournament 6-max BTN vs BB 3-bet   | 97.0 | 0    | 3.0       |

The 3-bettor risks 10bb to win 4bb (open, small blind, big blind already in),
so a bluff profits once the opener folds more than 71%; the horse folds 96%
of its open. Cause: V73 (the opener's continue read) starts at 25bb ("the
jam-or-fold zones own the spot"), but outside the tournament M zones they do
not, and the old branch's stack cap (a call may not exceed 35% of the stack)
refuses every call at 20bb, so nothing continues but the 4-bet jam bar.

## The changes (default off)

- `facingOpenFullRingZone`: four or more dealt, no-limit hold'em, facing
  action (never the unopened pot), the jam-or-fold zone is the V82 one
  (<= 12bb, or the M layer and <= 15bb). The orange-zone open shove (an
  owner decision) is untouched. On: six-max 20bb BB vs a BTN open folds
  28.1%, vs UTG 46.6%; four-max 27.4%.
- `vs3BetShortStack`: the V73 read reaches 12bb effective
  (`V73_SHORT_MIN_EFFECTIVE_BB`), and a hand the read continues whose call
  the stack cap refuses jams instead of folding. On: the 20bb button facing a
  3-bet to 11bb jams 23-24% of hands (about half its open).

## League (paired deals, 20,000 pairs per seed, charts hydrated)

| card                                  | field  | seed 1107      | seed 2207      |
| ------------------------------------- | ------ | -------------- | -------------- |
| facingOpenFullRingZone MTT 4-max 20bb | mirror | +1.38 +/- 0.79 | +2.82 +/- 0.80 |
| facingOpenFullRingZone MTT 6-max 20bb | mirror | +0.56 +/- 0.60 | +0.07 +/- 0.60 |
| facingOpenFullRingZone MTT 6-max 25bb | mirror | +0.20 +/- 0.13 | +0.20 +/- 0.13 |
| facingOpenFullRingZone MTT 9-max 20bb | mirror | inert          | inert          |
| facingOpenFullRingZone MTT 6-max 20bb | human  | -3.13 +/- 2.00 | -1.54 +/- 2.24 |
| vs3BetShortStack cash 6-max 20bb      | mirror | +0.30 +/- 0.24 | +0.70 +/- 0.27 |
| vs3BetShortStack cash 9-max 20bb      | mirror | +0.03 +/- 0.17 | +0.43 +/- 0.17 |
| vs3BetShortStack MTT 6-max 25bb       | mirror | -0.13 +/- 0.25 | +0.21 +/- 0.24 |
| vs3BetShortStack cash 6-max 80bb      | mirror | inert          | inert          |
| vs3BetShortStack cash 6-max 20bb      | human  | -2.98 +/- 1.31 | -0.15 +/- 1.28 |
| vs3BetShortStack MTT 6-max 25bb       | human  | -1.21 +/- 0.61 | +0.31 +/- 0.57 |

Neither flag clears the owner rule (significant positive on its cards and no
significant negative elsewhere): `facingOpenFullRingZone` is significant
only on one four-handed mirror seed and leans negative against the
human-calibrated field; `vs3BetShortStack` is significant positive on one
mirror seed per cash card but one human-field seed is below -2 stderr. Both
ship OFF with nightly cards (`mtt4_facing_open_full_ring_20bb`,
`nlh_20bb_vs3bet_short_stack`) so the league keeps measuring them.

A third candidate, the heads-up small blind's answer to a 3-bet (it opens
72% and folds about 86% of it to a 3-bet to 8bb at every depth), was built
(V73 for two dealt in, in position, as a share of the heads-up open) and
measured -1.57 +/- 0.88 / -1.99 +/- 0.83 (40bb) and -2.41 +/- 1.32 /
-3.14 +/- 1.31 (80bb) in the heads-up mirror: the horse big blind 3-bets
about 9% of hands, almost all value, and the wide fold is the right answer
to that range. It is not shipped; a defence widened only against an observed
wide 3-bettor would be the follow-up.

## Tests

`server/src/engine/HorseShortStackPreflopDefence.test.ts`: six-max 20bb
big blind folds > 80% off and < 40% on; four-handed on matches nine-handed;
the open, a 12bb stack and nine-handed 20bb identical on and off; a 20bb
button facing a 3-bet continues < 5% off and > 15% on (cash six- and
nine-handed); 40bb identical on and off; both flags off by default.
