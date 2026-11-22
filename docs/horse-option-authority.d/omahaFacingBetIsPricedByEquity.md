# omahaFacingBetIsPricedByEquity: Authority For The Live Switch

Built 2026-11-19 by EMERG lane FACING on the owner's orders of 7:31 PM and 7:38 PM Chicago (stop the PLO4/PLO5 bleeding; math first, real decisions from the data). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (table and Lightning; no Lightning or speed exclusion), high only, one board, no bomb pot, postflop, the Horse facing a bet or a raise whose last aggressor is a person (`is_horse === false`), and the wager_rules node's final answer is a fold (`server/src/engine/HorseOmahaFacingBetEquity.ts`, applied as the outermost answer of the wager_rules node in `HorseLogic.ts`):

- Equity: the Horse's showdown share recomputed with 600 card-seeded Monte Carlo runouts, exactly two hole cards and three board cards, one random holding of the Horse's own size for every live opponent (at most five), run to the river. The seed is the cards; the brain's random stream is never read. Sampling SE at most 0.020.
- Calibration: the raw share is mapped, by street, to the share against hands revealed at showdown: public information only (lead decision 2026-11-19; CONSTANTS.md, `OMAHA_FACING_EQUITY_PROVENANCE`). Hidden hole cards were used only to grade the finished rule offline. River multiway has too few revealed spots and gives no verdict.
- Realization: times the realization measured from the Horses' own flop and turn calls (chips the call won back, later streets included, over its all-in share); river 1.
- Price: paid / (pot + paid). The fold becomes the call only when realized equity minus the price exceeds the measured margin.

It changes only a fold, so a check, a call, a bet or a raise any earlier owner chose stands. Because it runs after the Omaha pack, it also covers decisions whose pack retained the reference (`reference_retained`) or was refused for depth (`depth_or_ante_outside_pack`). Outside the spot, or on any failure, the decision it was given stands, exactly as with the option off.

The response validator (`responseValidation.ts`, `omahaFacingEquityCalled`) re-runs the verdict on the request, which carries every input, and admits wager_rules fold -> call only where the re-run calls, for the exact chips of the call. The whole-stack form is an all-in, a wager action.

Receipt: `omaha_facing_bet_equity_call` (noteFire and the decision rule receipt, before fold, after call). The verdict's numbers are a pure function of the journaled request and are re-computable offline.

Default OFF in source (read `=== true`). Registered in the option switch by follow-up migration, switchable live, not off-only.

## What Was Measured

See `omahaFacingBetIsPricedByEquity.CONSTANTS.md`.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the graded 48-hour and held-out verdict replays are in omahaFacingBetIsPricedByEquity.CONSTANTS.md and archive repairs/EMERG/FACING.md)
