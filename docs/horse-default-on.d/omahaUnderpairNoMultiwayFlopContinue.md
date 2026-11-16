# omahaUnderpairNoMultiwayFlopContinue (owner complaint 2026-11-15, hand 59518335; branch agent/plo-underpair-01BbZPDi/fix/omaha-no-stack-off-with-underpair, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Production hand 59518335 (PLO5 1/2 cash): in a 4-bet pot of 561 on K-T-6 rainbow the big blind bet 139, the opener called, and the button called 139 of its last 220 with a pair of queens and a gutshot whose straight is not the nuts. Traced at source, the call is the committed-call branch of `HorseLogic.ts` (`if (eq15 >= required || solverCall32)`): estimated equity 0.26 to 0.30 (the Omaha pressure cap holds it at 0.30) against a required 0.177 (pot odds 0.143 plus the scaled multiway premium).

The option (`omahaUnderpairFlopFold` in `HorseLogic.ts`, cell `omahaUnderpairFlopCell` in `server/src/engine/HorseOmahaUnderpair.ts`) runs outermost on both decision paths. On an unpaired flop, facing a bet or raise AND a call of it by a second live opponent (`omahaFlopBetAndCallFaced`), a continue with exactly one pair below the top card of the board (a pocket pair under it, or a pair with a lower board card), no flush draw and fewer than eight nut-straight outs (`omahaUnderpairNoDraw`) folds, unless the call costs less than a tenth of the resulting pot.

## Input fidelity

Status: MET

Public action history, the board and the Horse's own cards only. The recorded decision is replayed from the public snapshot the engine stored with it (`HorseOmahaUnderpair.fixture.json`, anonymised to seats).

## Value

Status: NOT MET

Not measured. On the recorded hand the exact three-way equity against the two hands actually held was 15.3% for a direct price of 14.2% (about 21% when the rest of the stack is counted, which went in on the turn), so the recorded call was close to its price; the declared paired evaluation decides (league cards `plo4_omaha_underpair_no_multiway_flop_continue`, `plo5_omaha_underpair_no_multiway_flop_continue`).

## Continuation

Status: NOT MET

Not measured separately. A flop fold ends the hand; the paired evaluation's arms include the later streets of the hands where the continue was kept.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the fold receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only, the flop, fold legal. Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside. `HorseOmahaUnderpair.test.ts`: unset, false and a truthy non-boolean decide byte-identically; on, the recorded call folds at every seed and draws nothing from the random stream; a set, top pair, an overpair, a flush draw, a nut wrap, a heads-up flop, a price under a tenth of the pot and Hi-Lo keep today's decision; PLO4 gets the rule; the fold is admitted by the worker receipt validator; the recorded re-raise and the priced turn all-in are unchanged.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_underpair_no_multiway_flop_continue` (folded) and `omaha_underpair_no_multiway_flop_continue_priced_in` (kept on the small price).

## Limits

Status: MET

- The rule is structural: it does not read who bet or how often he bluffs.
- A pocket pair above the top card, top pair and every two pair or better are outside; so is any flush draw, nut or not.
- The price bound (a tenth of the resulting pot) and the eight nut-straight outs are declared values, not fitted ones.
- Live behaviour is unverified: the option is off.
