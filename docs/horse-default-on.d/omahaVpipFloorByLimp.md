# omahaVpipFloorByLimp (owner instruction 2026-11-15 11:35 America/Chicago, hand 59518335; branch agent/plo-underpair-01BbZPDi/fix/omaha-no-stack-off-with-underpair, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: "ADD IN A LIMP FOLD TO GET THE VPIP UP IF THEY ARE NOT PLAYING ENOUGH HANDS. THEY SHOULDN'T BE PUTTING IN TON'S OF CHIPS AND RAISING JUST TO MEET THE 50% VPIP. LIMP FOLD IS VPIP."

How the floor enters a decision today (all preflop; nothing postflop reads it):

- `HorseLogic.ts` `vpipFloorMul`: a multiplier in [0.35, 1]. With no judged sample (fewer than 3 hands) it is 0.28 divided by the target; with one it is 1 minus 1.5 times the gap between the target and the Horse's own judged VPIP. The target (`vpipTargetFor`) is the floor plus 1.3 standard errors over the judged window: 70.6% for a 50% floor in PLO. At or above the target the multiplier is 1 and nothing is lowered.
- `HorseLogic.ts`, the reference preflop set-up (`params.tightness *= vfMul`): the multiplier scales the style tightness, which `HorsePreflop.ts` multiplies into every bar (`t`, `tCall`, `t53`): the opening bars, the calling bars, the 3-bet bar, the 4-bet bar and the jam bar alike.
- `HorsePreflop.ts` PLO6-AUDIT-004 (`floorMul91`, option `vpipFloorDeepStackOff`, off): reads the 4-bet and jam bars without the floor, only deeper than 120 big blinds and only when the call is at most 30% of the stack.
- `HorseLogic.ts` `vpipFloorCallDown`: a preflop fold for at most 6 big blinds and 15% of the stack becomes a call with probability ten times the gap (certain from a ten-point gap). This already limps first in, and already calls a raise after a limp.

A limp counts: `server/src/services/supabase/handFacts.ts` (`deriveFlowFlags`) sets `vpip` on any preflop call, bet, raise or all-in by the player, and a later fold does not clear it; `fn_nit_check` judges that column. `HorsePreflop.ts` carries the owner's rule of 2026-08-30, "NO OPEN-LIMP: first in, it is raise or fold", written against exactly the limp-then-fold this option introduces; the instruction of 2026-11-15 is newer and is applied only under an unmet floor, only with this option on.

The option (PLO4/PLO5 cash, the multiplier below 1; `omahaVpipFloorByLimpIntent` in `HorseLogic.ts`) takes the same preflop decision a second time without the floor, on the same random position (rewound, telemetry suspended), and:

1. first in or in a limped pot, a raise the unfloored brain does not make becomes the limp (or the small blind's completion);
2. facing a raise, a re-raise or shove the unfloored brain does not make becomes its call; when it would fold, a call only at the call-down's own price (6 big blinds and 15% of the stack), otherwise the fold;
3. having limped and facing a raise, the unfloored decision stands (the hand folds unless it clears the ordinary bar), and the call-down does not buy the call back.

A raise the unfloored brain makes is unchanged, and so are the calls and limps the floor buys today.

## Input fidelity

Status: MET

The table's floor, window and the Horse's own judged VPIP as the live engine hands them to the decision (`ServerTableEngineBase.horseVpipDecisionInputs`), the public state and the Horse's cards. A recorded snapshot carries the floor and the window but not the Horse's own VPIP, so the recorded hand is replayed without it and at 20, 30, 40, 50 and 90%.

## Value

Status: NOT MET

Not measured, and the league cannot measure it: `playHand` seats no floored table, so the two arms play identical poker (0 of 300 pairs diverged; refused matchups `plo4_omaha_vpip_floor_by_limp` and `plo5_omaha_vpip_floor_by_limp`). Whether limping keeps a Horse above the floor as well as raising does is also unmeasured: a limp counts as one hand of VPIP exactly as a raise does, so the judged rate should not fall, but no sitting has been run.

## Continuation

Status: NOT MET

Not measured. A limped hand that is not raised plays its flop with today's postflop brain.

## Reach

Status: NOT MET

Not counted in production. The receipts count it once the option is on.

## Scope

Status: MET

PLO4 and PLO5 cash with a VPIP floor still unmet. Hi-Lo, PLO6, hold'em, tournaments, bomb pots and all-in-or-fold tables are outside. `HorseOmahaVpipFloorByLimp.test.ts` (26 cases): unset, false and a truthy non-boolean decide byte-identically; first in, hands the unfloored brain folds limp and never raise; having limped they fold to a raise and the call-down does not call; the recorded queens call the raise after a limp; hand 59518335's re-raise to 50 becomes a call of 9 and its shove facing the 4-bet becomes a call; suited aces and every hand the unfloored brain raises are byte-identical; a floor already met, a table without a floor, Hi-Lo and the postflop decisions are unchanged.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_vpip_floor_limp`, `omaha_vpip_floor_limp_fold`, `omaha_vpip_floor_three_bet_bar_kept`.

## Limits

Status: MET

- The big blind's option (nothing to call) has no cheaper voluntary action than a check, which is not VPIP; a raise only the floor makes there becomes the check.
- A Horse that open-raised on merit and is re-raised keeps today's floored calling bar; only a limp is treated as having met the floor for the hand.
- The steering target is 70.6% on a 50% table, so the rule is active until the Horse's judged VPIP is well above the floor itself.
- Limping in order to fold is exploitable by a player who raises every limp; nothing here reads that.
- Live behaviour is unverified: the option is off.
