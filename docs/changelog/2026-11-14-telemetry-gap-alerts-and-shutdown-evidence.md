# A Lost Horse Telemetry Batch Reaches Production Alerts The Same Day, And The Telemetry Stop Says How Long It Took

Two connected changes in the Horse brain telemetry flush, on top of #10732 (95bef531).

Measurement path only: no decision, wager, think time, queue or deadline changes.

## Why

Since #10732 a telemetry batch can be lost in four ways: the database writer refuses its bytes (`rejected`), it stays unconfirmed for an hour (`abandoned`), it is older than the retained receipt window (`expired`), or the engine stops before it is written (`shutdown_unwritten`). Each was counted and passed to `reportError`. `reportError` is `console.error` and nothing else (`server/src/services/errorReporter.ts`): a line in the host log. Nobody was told, and a day with a lost batch has incomplete counters, so the daily upgrade audit's numbers for that day are only a lower bound.

The fit of the telemetry stop inside the engine's 40,000 ms graceful deadline was arithmetic and had never been measured.

## What Changed

### 1. The four losses are engine alerts

- New `server/src/services/horseTelemetryGapAlert.ts` builds an ordinary engine alert and hands it to the existing `raiseEngineAlert`. No new channel, watcher, cron or polling loop. The path from there is the one every engine alert takes: durable journal, `POST /api/alerts/engine` on World Hub, `fn_record_engine_alerts`, `engine_alerts`, the `a00_operational_source_intake` trigger, `operational_alert_events`, Production Alerts.
- Alert names: `HorseTelemetryBatchRejected`, `HorseTelemetryBatchAbandoned`, `HorseTelemetryBatchExpired`, `HorseTelemetryShutdownUnwritten`. Severity `warning`, the same as the other Horse measurement alert (`HorseRiverValueLeak`). Never a page: the alert priority is `normal`, so nothing reaches a phone that the existing alert policy would not send.
- One alert per kind per UTC day, by the alert system's own key. The alert system de-duplicates by fingerprint `alertname:component` and does not raise a fingerprint that is already firing. The component is `horse-telemetry-<day>`, so a second loss of the same kind on the same day is the same fingerprint, and a loss on a new day is a new one. There is no timer and no state in the new file. When a later day's alert of a kind is raised, the earlier days' alerts of that kind still firing are resolved, so the journal holds one open alert per kind.
- The day in the alert is the day the lost batch belonged to (the batch's own `day`), not the day it was given up. A batch collected at 23:30 and abandoned at 00:30 alerts for the day before.
- The message says, in plain words, what was lost, for example `Horse telemetry for 2026-11-14 is incomplete: 1 batch refused by the database writer and dropped`, and the description names the publisher's worker id, the thread, the lower-bound consequence and the counter that keeps counting after the day's one alert.
- A Horse decision worker thread runs its own telemetry flush. The alert journal has one owner per process, the main thread, so a worker never raises: it posts a `HORSE_TELEMETRY_GAP` message (`horseDecision/worker.ts`) and the main thread raises it (`horseDecision/client.ts`). `BrainTelemetryFlush.ts` imports the alert module's types only and loads the module on the main thread on first use, so no worker ever opens the alert journal.
- A shutdown that runs out of time before the last partial minute was even captured used to report nothing, because no batch was left in the queue. It now reports that the last partial interval was not captured, and alerts it.

### 2. The daily audit reports the day as incomplete

Migration `20261114001636`: `fn_audit_data_receipts(p_day)` gains one finding, `telemetry_incomplete`, severity `note`, when `phase15_telemetry_batch_rejected` or `phase15_telemetry_batch_abandoned` is positive on that day. It is a notice, not a floor: both keys stay receipts with no `minRatio`. The function body is patched in place before its final `return v_findings;`, found exactly once or the migration fails and changes nothing; a second run is a no-op.

### 3. The telemetry stop prints what it really took

At the end of every telemetry stop that was active, one line in the host log, next to the existing `[GameServer] shutdown service ... took ...ms to stop` lines:

`[BrainTelemetryFlush] shutdown stop thread=worker worker_id=<id> outcome=complete duration_ms=412 drain_ms=0 batches_written=2 batches_dropped=0 batches_unwritten=0 interval_captured=true budget_ms=20000 max_batches=32`

One line per stopping thread (the main thread and each Horse decision worker). `outcome` is `complete`, `time_budget`, `batch_bound`, `unconfirmed_write` or `superseded`. `drain_ms` is the wait for a write that was already in flight when the stop began and is inside `duration_ms`. The engine keeps no shutdown-phase record to add this to; it logs each phase as a line, so this is a line.

`HORSE_JOURNAL_STOP_TIMEOUT_MS` (5,000) names the literal the journal publisher's stop already used, so the worker's shutdown series can be checked against the engine deadline in a test.

## Limits, Stated

- At most one alert per kind per day per alert journal, and the journal is on the host: an engine restarted the same day does not alert the same kind again. The count in the alert is the count at the first loss; later losses that day are in the counter, not in the alert.
- Resolving the earlier day closes that alert in Production Alerts. It does not mean the earlier day became complete; the resolution note says so.
- The audit finding counts a drop on the day it happened. A batch collected late one day and abandoned in the first hour of the next is counted on the next day, so the day before may be the incomplete one. A day with no drop is not proven complete: a batch lost at shutdown or with a crashed process has no counter. When the audit runs more than 36 hours after its day, `fn_horse_audit_mark_run_time` adds its run-time note to every finding of this section, this one included, although this finding reads the day's own rows.
- `shutdown_unwritten` has no counter and gets none: nothing fired during the last stop can be written.
- The measured stop bound is for the telemetry stop alone. The worker's series is the journal stop (gives up at 5,000 ms) and then, together, the telemetry stop (starts no write that could end past 20,000 ms) and the mind persistence stop. With the 12,000 ms between-hands drain ahead of them that is 37,000 of the engine's 40,000 ms, not the "about 32" the 2026-11-13 changelog gave: it left out the journal stop. The mind persistence stop has no time bound of its own (see the findings in the PR).

## Regression

- `horseTelemetryGapAlert.test.ts`, over the real alert delivery and an in-memory journal: two losses the same day are one alert; a new day is a new alert and closes the earlier day; a late loss for yesterday does not close today's; each kind is separate; the message, severity, labels and normal priority for each kind; an invalid gap raises nothing; an unreadable journal does not throw.
- `BrainTelemetryFlush.gapsAndStopEvidence.test.ts`, over the real flush service: each of the four losses hands one gap with its kind, count, batch day and worker id; the abandoned batch across midnight carries the batch's day; a worker's sink receives the gap and nothing is raised in that thread; a throwing sink does not stop the flush; a slow writer (4,900 ms a write) is cut off by the budget with duration 19,600 ms, 4 written and 1 unwritten in the line; a complete stop, a batch dropped during the stop, a write in flight when the stop began and a failed stop each print the right line; for writers of 1 to 5,000 ms the stop never passes its budget plus one write timeout and the printed duration equals the time measured from outside.
- `horseDecision/telemetryGapRelay.test.ts`: the main thread raises the alert for a worker's message; the worker's sink is set before its runtime starts; the flush service never imports the alert module as a value; the journal stop comes before the telemetry stop; drain + journal stop + telemetry budget is inside the graceful deadline.
- Mutation checks: 23 single-line breaks of the alert calls, the fingerprint, the relay and the duration record, each killed by one of the three files.
- The migration was applied on a scratch PostgreSQL 17 cluster to the 20260904224836 and 20260906150532 definitions: no drop counter, no finding; rejected 2, one note; abandoned 1 on another day, one note for that day only; second run unchanged; owner, definer, search path and ACL kept; a body without the anchor fails and changes nothing.
