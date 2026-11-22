# fixedLimitOmahaNoPresumption: authority for the live switch

No owner order to switch this option on is recorded. Evidence NOT MET: the option stays OFF (read `=== true`, release default off, no switch row). It acts on fixed-limit Omaha hi-lo only, and the league deals no legal flo8 hand, so it has no league measurement and no replay.

## What it does

On a fixed-limit Omaha decision (flo8) `HorseMind.opponentRead` does not apply the shared aggressive raise presumption, a pot-limit policy that prices a pot-sized raise; the opponent's own measured read stands. Pot-limit Omaha is unchanged (Tight fix T1).

## The order it rests on

No owner order to switch this option on is recorded in this repository. The Antigravity Coordinator's standing delegation (owner, 2026-11-20 15:01 America/Chicago) covers evidence work and decisions on this code base; it is not an order to activate this option, and this file proposes no switch row.

## Receipts and tests

Receipt `fixed_limit_omaha_presumption_withheld`. Law `server/src/engine/AFixedLimitOmahaHasNoPresumption.law.test.ts`. No league card: every flo8 arm is refused (`UNMEASURABLE_MATCHUPS`), because the league's settlement awards one high hand and has no low half (`docs/horse-league-fixed-limit.md`, "Hi-lo settlement").

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

- Mechanism: MET by the law's fixtures.
- League: NOT MEASURED on a legal game. The refused arm `flo8_no_omaha_presumption`, run on the no-limit betting the league still gives flo8, diverged in 81 of 300 pairs (seed 20261115); that is not a fixed-limit measurement.
- Value, continuation, reach against people: NOT MEASURED in this repository. The ledger records the lane's diagnosis before the fix (a 21 to 27 percent flo8 raiser stayed presumed at 1,000 hands); its archive is outside this repository.
- Historical human FLO8 micro-replay check (2026-11-21, read-only against the 107 retained `has_human` flo8 hands from 2026-11-03 02:40 to 03:53 UTC, 1 person and 5 Horses, `audited-node-option-replay.ts` with 76,098 `has_human` history hands as of decision and `prod-switch-20261121T1500Z.json`, zero hole cards stored): only 43 of 107 hands carry `hole_cards` (showdown hands), yielding 336 replayable `horse_policy` nodes (74 preflop, 94 flop, 87 turn, 81 river; 0 arm errors; base fidelity 276/336 = 82.1%). On those 336 nodes, `fixedLimitOmahaNoPresumption` fired `fixed_limit_omaha_presumption_withheld` on 336/336 nodes and changed **4 / 336** decisions (2 preflop, 1 flop, 1 turn; `raise->call: 2`, `fold->raise: 1`, `call->fold: 1`). Zero placed audit verdicts exist for these hands, and 4 changed decisions from a single person's 73-minute session is not a replay gate.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. Hi-lo settlement in the league (`playHand`: the qualifying low, the halves per side pot, quartering and the odd chip, proven against a real `HandController` on flo8), then a card and a field in which the option acts.
2. The Value row: three opponent ranges, one value-only, with a per-node table.
3. An audited fixed-limit Omaha hi-lo decision set against people. None is named in this repository, so no Replay row can be written. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".
5. An order to activate, recorded verbatim above.

## What the activation row must contain

`option = 'fixedLimitOmahaNoPresumption'`, `state = 'on'`, note `authority: fixedLimitOmahaNoPresumption docs/horse-option-authority.d/fixedLimitOmahaNoPresumption.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit Omaha hi-lo decision set is named in the repository)
