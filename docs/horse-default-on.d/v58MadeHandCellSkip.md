# v58MadeHandCellSkip (#8144)

Originally shipped on by default on 2026-10-26 in #8144 under `v57TournamentAggression` (`docs/changelog/2026-10-26-a-made-hand-is-not-its-class-average.md`), and split onto its own independent default-ON option `v58MadeHandCellSkip` with zero default-ON behavior change so `v57TournamentAggression` no longer reaches cash or Lightning made-hand cell skips.

## Mechanism

Status: MET

When evaluating open-node postflop advice from `gto_postflop_compact`, the solver cell holds the mean of a hand class over every board in a texture class (e.g., `AJs` on a monotone flop is mostly ace-high without the suit, so the cell checks 76%-84% even when hero actually holds the nut flush). When hero holds a made set/trips, straight, flush or better (`cat >= 4`), `madeBeyondClass58` skips the class-mean compact cell and hands the decision to the value ladder below (`HorseLogic.ts`, pinned by `HorseMadeHandBeatsClassMean.law.test.ts`).

## Input fidelity

Status: MET

Reads only `cat >= 4` from the hand evaluator on hero's actual hole cards and community cards plus the boolean option `opts.v58MadeHandCellSkip !== false`. No opponent read or hidden state is consulted.

## Value

Status: MET

Directly fixes Dan's 2026-10-26 live production defect (Hand 48442708, A-J of clubs flopping the nut flush on Q-5-8 of clubs and checking flop, turn, and river; replayed flop bet rate moved from 17% to 80%+ and turn from 21% to 93%+ in #8144). Splitting the option out of `v57TournamentAggression` preserves 100% identical default-ON behavior across every format while preventing `v57TournamentAggression: false` from reintroducing the nut-flush check bug in cash and Lightning.

## Continuation

Status: MET

Skipping the open-node compact cell hands the open decision to the existing postflop value ladder, which sets the normal bet size and raise-response continuation plan for sets, straights, flushes, and full houses.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): `v58_made_hand_cell_skip` fires ~2,493 times/day across NLH cash, Lightning (`fmt_l_v58_made_hand_cell_skip` ~474/day), and tournaments. Holdings below trips (`cat < 4`) never trigger it and continue reading the solver cell unchanged.

## Scope

Status: MET

Two-card Hold'em open-node `gto_postflop_compact` consults in cash, Lightning (`gameMode: 'cash'`), and tournaments whenever hero holds `cat >= 4`. PLO4/PLO5/PLO6 and other non-Hold'em variants do not enter the compact Hold'em open-node cell consult and are completely unaffected.

## Visibility

Status: MET

Emits telemetry receipt `v58_made_hand_cell_skip` (`HorseDataLedger.ts`) whenever the skip fires. Registered in `HORSE_DATA_LEDGER` as flag `v58MadeHandCellSkip` and held in `OPTION_SWITCH_REFUSED` as a defect guard (never switched off via the live DB option switch without a dedicated registration migration).

## Limits

Status: MET

This split does not change default-ON behavior or alter any other `v57TournamentAggression` read site (all 5 remaining `v57TournamentAggression` read sites are strictly tournament-gated). Explicit `v58MadeHandCellSkip: false` remains available in `HorseDecideOpts` for isolated unit testing and counterfactual evaluation.
