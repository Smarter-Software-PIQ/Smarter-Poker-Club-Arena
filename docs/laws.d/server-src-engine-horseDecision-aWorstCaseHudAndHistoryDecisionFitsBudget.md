# server/src/engine/horseDecision/aWorstCaseHudAndHistoryDecisionFitsBudget.law.test.ts

A worst-case 6-max or 9-max Horse decision request carrying full capped opponentHud (~704 KiB), unacknowledged ownPublicHistory (~1.40–1.85 MiB), and board/action state must fit inside HORSE_REQUEST_MAX_BYTES (4 MiB) and HORSE_REQUEST_MAX_NODES (65536) with at least 256 KiB of headroom so live PLO5/NLH horses never hit HorseRequestCapacityError and fall into sticky check/fold fallback loops.
