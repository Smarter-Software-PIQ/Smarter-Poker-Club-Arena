# v69V32DrawNoRoom (#8902)

Originally shipped on by default on 2026-10-31 in #8902 under `v69TurnCallGaps` (`docs/changelog/2026-10-31-v69-turn-call-gaps.md`), and split onto its own independent default-ON option `v69V32DrawNoRoom` with zero default-ON behavior change so disabling `v69TurnCallGaps` (one-pair turn implied odds) or `v69HoleDrawExemption` (hole-card draw exemption) never cross-disables the V32 turn draw pass-through no-room check.

## Mechanism

Status: MET

Inside the opt-in V32 facing-bet defense layer (`opts.v32FacingDefense === true`, `HorseLogic.ts`), when the solver cell answers `call` on the turn with a drawing hand (`drawy32 && !isRiver`), V34 previously guaranteed the call (`solverCall32 = true`) before the heuristic / V38 line ran. When `opts.v69V32DrawNoRoom !== false` and `v68NoRoomToBePaid(...)` holds (wager >= 0.7 pot and effective stack behind after calling < 1.5x pot), the call is not guaranteed and instead falls through to the normal call-pricing line (`HorseTurnCallGaps.test.ts`, `HorseHoldemBlanketDecouplingV69V73.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot size, bet size (`toCall`), effective stack behind after call (`v68BehindAfterCall`), street (`'turn'`), and the boolean option `opts.v69V32DrawNoRoom !== false`. No opponent read or hidden state is consulted.

## Value

Status: MET

Closes the V32 turn draw auto-call leak measured in #8902 when stacks behind cannot pay off a draw, preventing unconditional turn calls on short behind stacks whenever `v32FacingDefense` is enabled in tests or leagues. Splitting this sub-rule onto its own flag keeps `v69TurnCallGaps` strictly a single-rule switch while preserving 100% identical default-ON behavior.

## Continuation

Status: MET

When `v68NoRoomToBePaid` triggers, skipping `solverCall32 = true` hands the decision cleanly to the standard turn raise/call/fold evaluation below, which prices the draw against direct pot odds without the implied-odds allowance. Deep-stack turn draws keep `solverCall32 = true` unchanged.

## Reach

Status: MET

Zero live production fires while `v32FacingDefense` remains opt-in (`OPTION_SWITCH_OFF_ONLY`). Active in unit, law, and counterfactual tests that explicitly enable `v32FacingDefense: true` on turn draw spots with short effective stacks behind.

## Scope

Status: MET

Strictly nested inside the `opts.v32FacingDefense === true` heads-up two-card Hold'em single-board turn defense consult (`!vi.isOmaha && !vi.isFixedLimit && vi.holeCount === 2`). Flop, river, and all Omaha variants (PLO4, PLO5, PLO6) cannot reach it and are completely unaffected.

## Visibility

Status: MET

Emits telemetry receipt `v69_turn_call_gaps` (`HorseDataLedger.ts`) whenever the V32 turn draw pass-through is withheld for no room to be paid. Registered in `HORSE_DATA_LEDGER` as flag `v69V32DrawNoRoom` and held in `OPTION_SWITCH_REFUSED` as a sub-rule of off-only `v32FacingDefense` (not registered in the SQL switch without a dedicated migration).

## Limits

Status: MET

This split does not change default-ON behavior, does not enable `v32FacingDefense`, and does not alter V69 (1) one-pair implied odds (`v69TurnCallGaps`) or V69 (2) hole-card draw exemption (`v69HoleDrawExemption`). Explicit `v69V32DrawNoRoom: false` remains available in `HorseDecideOpts` for isolated unit testing and counterfactual evaluation.
