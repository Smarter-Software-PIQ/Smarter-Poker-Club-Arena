# A VPIP-Floor Limp, Raised, Folds (vpipFloorLimpFoldsToARaise, Default Off)

Owner, 2026-11-17 14:34 Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops." And 18:38: the floor never buys a call of a raise.

## What was found

The limp-only floors (`vpipFloorLimpOnly`, on in production; `lightningVpipFloorLimpOnly`) make the limp and forget it. Raised, "the unfloored decision stands": the whole preflop brain runs again on a hand it had just folded for one big blind. In PLO4/PLO5 cash hands with a person, 2026-11-20 05:00Z to 11-27 05:00Z, 2,407 floor limps faced a raise; 322 called it and 1 re-raised (PLO5 thirty-hand tables 306 of 2,144, 14.3%). With the raiser's own record loaded the call comes from the measured-wide-raiser price (`maniac_pressure_preflop`, `v53_pressure_preflop`, `maniac_call_down`). The engine kept no mark of a floor limp on the hand, so each was identified by re-deciding the limp with the Horse's own cards and no floor (fold on 5 of 5 seeds while the live Horse called).

## What changed

- `vpipFloorLimpFoldsToARaise` (default OFF, read `=== true`). With it on, the limp `vpipFloorLimpOnlyStep` makes leaves the worker with the private mark `vpipFloorLimp`; the table engine (`ServerTableEngineTurns`, `currentHandVpipFloorLimps`) and the Lightning hand host remember the accepted limp for that hand and hand it back as `gs.ownVpipFloorLimpThisHand`; that Horse's preflop decision facing a raise after the limp is a fold whatever the brain proposed (`vpipFloorLimpFoldsToARaiseStep`, inside the reference and again at the frame around the decision).
- Receipts `vpip_floor_limp_raised_fold`, `vpip_floor_limp_raised_fold_kept`, `vpip_floor_limp_raised_fold_restored`.
- The remembered limp is outside the policy sampling key (`validatedHorsePolicySamplingKey`), never stored with the public node, and carries no card and no opponent fact.
- A switch-list migration registers the option. It writes no row.

## Not changed

Option off: no mark, nothing remembered, every decision byte for byte and draw for draw the one it was. No floor is added to any game; no limp is made that was not made before; a limp the unfloored brain chose keeps the unfloored answer; nothing postflop. The ten-hand tables that `vpipFloorLimpOnly` leaves on the old floor are untouched unless `vpipFloorLimpOnlyTenHandWindow` is on as well.

## Evidence

`server/src/engine/aVpipFloorLimpFoldsToARaise.law.test.ts` and `docs/horse-option-authority.d/vpipFloorLimpFoldsToARaise.md`.
