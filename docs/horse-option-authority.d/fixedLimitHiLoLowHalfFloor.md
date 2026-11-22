# fixedLimitHiLoLowHalfFloor: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). It acts on fixed-limit Omaha hi-lo only, and the league deals no legal flo8 hand, so it has no league measurement and no replay.

## What it does

On a fixed-limit hi-lo river the V40 weak-high pressure cap never goes below half of the sampled low share, heads-up and multiway (`HorseHiLoLowHalf.ts`; Fixed-Limit adaptation fix F3).

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_hilo_low_half_kept_seen`. Law `server/src/engine/AFixedLimitHiLoLowHalfIsKept.law.test.ts`. No league card: every flo8 arm is refused (`UNMEASURABLE_MATCHUPS`), because the league's settlement awards one high hand and has no low half (`docs/horse-league-fixed-limit.md`, "Hi-lo settlement").

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

- Mechanism: MET by the law's fixtures.
- League: NOT MEASURED on a legal game. The refused arm `flo8_hilo_low_half_floor`, run on the no-limit betting the league still gives flo8, diverged in 6 of 300 pairs (seed 20261115); that is not a fixed-limit measurement.
- Value, continuation, reach against people: NOT MEASURED in this repository. The ledger records the lane's diagnosis before the fix (flo8 six seats: river hands with a low half of 0.46 and 0.59 capped to 0.10 and 0.13 and folded 66 of 83); its archive is outside this repository.
- Historical human FLO8 micro-replay check (2026-11-21, 336 replayable `horse_policy` nodes from the 43/107 showdown hands of the 2026-11-03 02:40 to 03:53 UTC 1-person session, 0 arm errors, 0 placed audit verdicts): `fixed_limit_hilo_low_half_kept_seen` fired 6 times with **0 / 336** decisions changed.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. Hi-lo settlement in the league (`playHand`: the qualifying low, the halves per side pot, quartering and the odd chip, proven against a real `HandController` on flo8), then a card and a field in which the option acts.
2. The Value row: three opponent ranges, one value-only, with a per-node table.
3. An audited fixed-limit Omaha hi-lo decision set against people. None is named in this repository, so no Replay row can be written. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitHiLoLowHalfFloor'`, `state = 'on'`, note `authority: fixedLimitHiLoLowHalfFloor docs/horse-option-authority.d/fixedLimitHiLoLowHalfFloor.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit Omaha hi-lo decision set is named in the repository)
