# One Horse Shard's Loss Is One Shard's Loss

2026-11-06.

## Before

`LiveHorseDecisionWorkerPool` runs up to eight decision workers. Any one of
them dying after boot reached `onFatal`, and GameServer's `onFatal` revokes
every dealer and throws, so the whole engine process restarted: every table,
every live hand, and all eight shards' learned horse memory, to replace one
isolate.

## Now

`lane.ts` gives each client its own `onFatal` that goes to the pool:

1. The dead client has already rejected its queued and in-flight work to the
   callers, whose existing liveness fallback checks or folds those seats.
2. The pool builds a new client for that shard index, from the same options,
   and routes the shard to it at once. Until it is READY the lane reports
   `starting`, so the horse fleet seats no new horse that cycle.
3. On READY the replacement must report the same solver corpus identity as
   the first booted worker, or the process ends as before.
4. Every replacement is logged and counted: `shardReplacements` on the lane
   status and `/health`.

It is still process-fatal when the pool has not finished booting, while it
is stopping, when the replacement cannot become READY, when it loads a
different corpus, and when one shard has already been replaced three times
in 30 minutes. A worker that keeps dying is a defect a fresh process should
surface.

Plans issued by the dead worker find no ownership on the replacement and are
refused as a recoverable request error; nothing is applied twice.

Law: `server/src/engine/horseDecision/oneShardsLossIsOneShardsLoss.law.test.ts`.
