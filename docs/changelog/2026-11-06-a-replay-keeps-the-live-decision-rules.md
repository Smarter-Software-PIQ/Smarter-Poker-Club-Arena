# A Replay Keeps The Live Decision Rules

Found 2026-11-06 by the controlled coverage suite for the horse decision
capabilities whose live evidence is thin (evidence folder
`hybrid-release-20261105/controlled-coverage/`). Offline only; no production
read or write is involved in the change.

## What Was Wrong

`HorseComplaintReplay.stateAt` rebuilds a horse decision from the public node
the engine records with every decision. The live engine's decision state
(`ServerTableEngineTurns`) carries `stateSchemaVersion: 1` and the table's
`allInOrFold` rule, and `HorsePublicActionNode` records `allInOrFold` in the
node. The replay dropped both:

1. Without schema version 1, `enforceAuthoritativeDecision` (the authoritative
   legal-menu check) never runs, so a replayed answer could leave the
   recorded menu.
2. Without `allInOrFold`, an all-in-or-fold node replayed as an ordinary table.

Together they hid #8196 from every replay. At an AoF node where the V27
big-blind-vs-jam chart calls, the live engine commits the all-in; the replay
returned `call` on a fold or all-in menu. Measured with the production chart
rows on 30 sampled stored horse profiles (all resolve to the Hybrid dials):
1,540 of 3,380 MTT and 640 of 1,690 cash AoF replays answered outside the
menu, while the production-shaped state answered all-in on every one of them
and folded none of the hands the ordinary menu calls.

Live decisions were never affected: the engine always sends schema version 1
and the AoF flag. The defect was in the replay instrument that complaint
replays, the complaint CLI and the controlled suites rely on.

## The Fix

`stateAt` now sets `stateSchemaVersion: 1` and `allInOrFold` from the recorded
node (false for nodes recorded before the field existed).
`ComplaintPublicNode` declares the field.

## Proof

`server/src/engine/horseComplaints/a-replay-keeps-the-live-decision-rules.law.test.ts`
(law `docs/laws.d/a-replay-keeps-the-live-decision-rules.md`) builds a recorded
AoF node with one production-shaped chart row and checks the rebuilt state,
that every replay profile answers fold or all-in with the chart reached, and
that the same chart call still replays as a call on an ordinary menu. It fails
on the previous `stateAt` (verified). The existing replay suites
(`HorseComplaintReplay.test.ts`, `HorseComplaintReplayCli.test.ts`,
`HorseFourBetThenFoldRealHands.law.test.ts`, `horseComplaints/`) pass
unchanged.
