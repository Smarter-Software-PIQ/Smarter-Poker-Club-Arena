# server/src/engine/horseDecision/aLostDecisionWorkerIsWritten.law.test.ts

A Horse decision worker that dies after boot is written to horse_error_log as worker_failed with its shard by the real pool (lane.ts) and the real writer (services/HorseErrorLog.ts), and is still replaced alone.
