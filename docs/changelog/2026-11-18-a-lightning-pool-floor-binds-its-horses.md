# A Lightning pool's VPIP floor binds its Horses; the re-raise pricing of a table reaches a pool hand (2026-11-18, both default OFF)

Owner, 2026-11-18 10:51 Chicago: "woowoo is currently playing lightning games plo5 1/2 these same features and functions need to be activated inside for those games as well for the horses if it hasn't already?" and 10:52: "yes if a game requires a vpip horses must always follow".

## What was found

A Lightning Horse decides in the same lane, with the same option switches, as a table Horse, so most of the PLO programme already ran in the pool (the priced call of a re-raise, #11247, included). Three things did not:

- The VPIP floor. Every Lightning Games row carries 40% in the ten-hand mode, and the Lightning decision snapshot carried neither the floor nor the Horse's own figure. PLO5 1/2 pool, 2026-11-18 from 11:46Z: 49 Horses, 19,842 dealt hands, VPIP 24.6%; 48 of 48 with ten or more hands under 40%. Nobody is removed from a pool for it, person or Horse: the rule runs in a physical table's dealing loop and a Lightning anchor runs the sit-out clock alone (0 pool sessions ended by the floor in 30 days).
- The position and realization correction of #11287, excluded from Lightning by `omahaReraisedLaneUntouched`.
- The priced turn and river raise (`omahaTurnRiverRaiseIsPriced`), excluded by `omahaPricedInScope` and `omahaRaiseNeedsNutsScope`. Not changed here (see below).

## What changed

- `lightningVpipFloorLimpOnly` (default OFF). The Lightning snapshot carries the pool's floor, window and the Horse's own count this pool sitting (`LightningHorseVpipLedger`) in `gameState.lightningVpipFloor`, outside the policy sampling key. With the option on, a Horse under its line turns a preflop fold in an unraised pot, for at most one big blind, into the limp or the small blind's completion: the one action of `vpipFloorLimpOnly`, with the same per-variant selection. It never raises and never calls a raise. The line is the ten-hand mode's own judgement, the whole sitting, plus three hands. Independent of `vpipFloorLimpOnly`, which never governs a pool.
- `omahaReraisedPositionInLightning` (default OFF). A Lightning PLO4/PLO5 cash call of a re-raise is priced as the same hand at a table: position by seat order against the re-raiser, no charge for a raiser or caller still to act.

Both are registered in the ledger with an authority file each. The switch-list migration that makes them switchable is not in this change.

## Not changed, on purpose

- Removal from a pool for falling under the floor (with the two-hour bar and fleet replacement) does not exist for anyone and is not built here: it must treat people and Horses alike and needs its own migration.
- `omahaTurnRiverRaiseIsPriced` in Lightning: it is not a one-line exclusion. Two scope functions, the rule-site guards and the worker's response validation (the raise-to-call admission and its option gate) all read the scope; a partial extension would have the worker refuse priced calls. Designed, not built.

## Evidence

Tests: `HorseLightningVpipFloorLimpOnly.test.ts`, `LightningHorseVpipLedger.test.ts`, `HorseOmahaReraisedPositionInLightning.test.ts` (recorded Lightning PLO5 lines of 2026-11-18, anonymised to seats; the deciding Horse's own cards only). Value on Lightning hands is not measured for either option; each has a declared evaluation that needs a journal export of Lightning decisions.
