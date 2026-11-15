# PLO6 commitment-zone re-raise price relief (2026-11-14)

Option: `omahaCommitZoneThreeBetPriceRelief`, default OFF (only explicit
`true` turns it on), registered in `HorseDataLedger.ts`. No production
behaviour changes.

## What

In `decidePreflopV7Core`, V25 PLO commitment zone, facing action: when the
option is on and the Horse holds six-card Omaha high (not hi-lo) facing two or
more raises, the call-off bar's price relief is `max(0, 0.5 - odds) * 1.6`
instead of the existing `(0.4 - odds) * 1.2` (which applies only at odds of
0.4 or better). Everything else in the branch is unchanged. The option is
passed from `HorseDecideOpts` into `PreflopCtx` only as `true` or `undefined`.

The commitment zone is a tournament branch (`ploTourney`), so cash tables are
not reached at any depth.

No receipt: the preflop receipt channel (`noteLayer`) needs a new
`PreflopLayerReceipt` member, a mapping in `HorseLogic.ts` and a ledger tag
consumer, which is new plumbing, so it was left out.

## Why

PLO6 tournament raise-then-fold leak: a Horse opened or called, faced a
re-raise inside the commitment zone, and folded at a price it had the equity
for. In the PLO6 tournament-folds study (Follow-up A, 20,000 PLO6 MTT hands at
40bb), 133 of the 220 clear mistakes were commitment-zone folds with equity
above the price plus 5 points; the commitment-zone price relief was the leading
single layer.

## Evidence (chips only, development human field)

Study folder: `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase2/
tournament-folds/` (`FINDING.md` follow-ups A, D, E; `PROTOCOL.md`).

| run                         | cell                                    | paired on - off bb/100 | SE   | z    |
| --------------------------- | --------------------------------------- | ---------------------- | ---- | ---- |
| A (all Omaha high, scratch) | PLO4 MTT                                | -26.44                 | 9.49 | -2.8 |
| D                           | PLO6 MTT 40bb, 200 x 200, seed 20261120 | +6.83                  | 3.78 | 1.81 |
| E (judged alone)            | PLO6 MTT 40bb, 200 x 200, seed 20261130 | +7.62                  | 3.77 | 2.02 |

The all-Omaha version was rejected because of the PLO4 control. The six-card
gate left PLO5 MTT and PLO6 100bb cash byte-identical (0 changed hands).

## Limits

- Chips only, one hand at a time, against the development field (which misses
  its own fidelity criterion). Not a production win rate.
- Payout (ICM) was not measured. Extra preflop stack-offs are what a payout
  ladder can reverse, most of all near the bubble (D's bubble cell was positive
  in chips, which is not payout evidence).
- E passes the declared 2 SE bar by a hair; D alone did not.
- End to end, at prices of 0.15 or better the existing V13 priced-in guard
  turns the core's fold into a call; with the option on the core raises, so a
  few such calls become the pot raise. That shape was inside the measured
  prototype arm. Pinned in `server/src/engine/HorsePlo6CommitZoneRelief.test.ts`.

## League card

`plo6_mtt6_commit_zone_three_bet_price_relief_40bb` in `server/src/benchmark/HorseLeague.ts`
(PLO6, six-handed big-blind-ante MTT at 40bb with the live M state; arm A
turns the option on). Required by
`ADefaultOffFlagHasALeagueCard.law.test.ts`. A local self-play check at 500
pairs (seed 4242) diverged in 43 pairs, so the card is not inert; its value
is the nightly league's to measure.

## Activation

Stays off. Turning it on needs a payout-scored (ICM) evaluation that passes,
and a `docs/horse-default-on.d/` file for the option.
