# A Telemetry Batch The Writer Refuses Is Dropped And Counted, Never Resent Forever

The Horse brain telemetry publisher kept one retained batch per worker and resent the same bytes until the writer confirmed them. The writer (`fn_horse_brain_flush_receipt`, migration 20260914130422) refuses a batch above 4,096 counters, 256 latency rows or 524,288 bytes. A capture that grew past a bound, for example after a database outage of some tens of minutes at the current rate of about 950 counter keys a day, became a batch that could never be accepted: that worker's telemetry stopped for the life of the process and its in-memory counters grew without bound. Found by the Hold'em Strategy lane's independent review (inbox 2026-11-13T17:20:43Z); the fix is that lane's patch, read against main and delivered by the feature activation lane, which owns upgrade 13 measurement.

Measurement path only: no decision, wager, think time, queue or deadline changes.

## What Changed

- `HorseBrainTelemetryPublisher` splits one capture into as many batches as the writer's three bounds require, each with its own batch ID and sequence, and writes them oldest first. New counters stay in their accumulators until the queue is empty, as before.
- A refusal that is a property of the bytes (the writer's twelve `HORSE_FLUSH_*` validation and collision errors) drops that batch and returns `rejected`. A batch still unconfirmed after 60 flushes (an hour at one a minute), by error, thrown send or invalid acknowledgement, is dropped and returns `abandoned`. Both are evidence gaps and are counted as such: `phase15_telemetry_batch_rejected` and `phase15_telemetry_batch_abandoned`, each with an operator error report. `HORSE_FLUSH_EXPIRED` is unchanged.
- At shutdown `BrainTelemetryFlush` writes the retained batches and then every batch the last partial interval splits into, bounded by count (32) and by time (no write starts unless it can end inside 20 seconds, within the engine's 40-second graceful deadline). What is still unwritten is reported by count, never retried in a loop.

## Reading The New Counters

Both are receipts with no floor. A zero is the normal state. Any positive value on a day means that day's counters are incomplete for the worker that fired it; the daily audit's totals for that day are a lower bound, and a rate computed from them is not valid for that worker's share.

## Regression

- `HorseBrainTelemetryPublisher.split.test.ts`: a capture above each bound splits inside it and every counter is written exactly once; a deterministic refusal drops only that batch and the next one publishes; a batch unconfirmed for the attempt cap is abandoned and newer counters publish; a thrown send is retried with the same bytes.
- `BrainTelemetryFlush.test.ts`: shutdown writes a split capture to its end inside the count and time bounds and reports what it could not write.
- `HorseDataLedger`: two receipt rows, so the ledger law that every fired key is declared holds.
