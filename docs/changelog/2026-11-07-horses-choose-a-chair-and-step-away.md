# Horses choose a chair and step away like people

**Seat choice.** Both horse seating paths (the fleet's seeding loop and a horse answering a waiting-list seat offer) took the lowest open seat number, so tables filled 1, 2, 3, ... in arrival order. `HorseSeatChoice` now picks among the open chairs the way a person does: spread out from the players already seated, rarely right beside the last arrival, and slightly toward the button and cutoff of the hand being dealt (the button is read from the table's engine via GameServer). The pick is md5-deterministic per (horse, table, minute). It only chooses WHICH open chair: who may sit, the seat budget, waiting-list holds and the database's unique seat constraint are unchanged.

**Sit-outs.** `HorseSitOutChoice` replaces the rotator's inline break draw. A horse now steps away either for a hand or two (30-75 s, sat back in at the next cycle) or for a few minutes (2-3 min), at the same low, floor-shared rate and only at well-populated tables, through the engine's own sit-out (deferred to the hand end; the person's missed-blind and eviction rules apply). Both lengths end inside the five-minute eviction clock with a full cycle of slack.

**Hit and run.** A horse that still owes hands in profit is never sent on a sit-out: a sit-out the eviction clock ends is a cash-out, which would be a leave before meeting the hit-and-run rule. The rotator call-path test proves such a horse neither sits out nor leaves on draws that send a horse owing nothing.

**Not changed: buy-in amounts.** Varied buy-ins/top-ups were requested, but standing owner orders (October 26 and 31, `horsesBuyInForTableMaximum.law.test.ts`) require horses to select the legal table maximum for buy-ins, rebuys and refills. That law was left in force. Top-ups after losing (rotator Add Chips and Auto Top Up) and rebuy-or-leave after a bust (`HorseRebuyPolicy` stop-loss) already exist.

Tests: `HorseSeatChoice.test.ts`, `HorseSitOutChoice.test.ts`; updated source pins in `HorseLoneTable.test.ts` and `theRotatorMeetsADriftedFloor.test.ts`. Engine change: live with the next engine release.
