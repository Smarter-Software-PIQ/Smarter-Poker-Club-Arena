# Which Horse Exercised Which Upgrade Is On The Record

The brain counters (`BrainTelemetry.noteFire`) are fleet totals with no Horse identity, so "which of the 1,000 Horses exercised which approved upgrade" had no durable answer: `horse_brain_telemetry` says an upgrade's counter fired, `horse_brain_activity_rollup` says a Horse decided, and nothing joined the two. This adds a permanent per-Horse record.

Measurement path only: no decision, wager, think time, queue or deadline changes. Pillar 2, R7/R8 and both held-out packs stay off.

## What Changed

- `BrainTelemetry.withDecisionFireScope(fn)`: while `fn` runs, every counter `noteFire` counts is also collected into a per-decision set (after `noteFire`'s existing enabled check, so a suspended evaluation or a process with telemetry off adds nothing). Restores the previous scope in a `finally`; a nested call hands its keys to the outer scope.
- `engine/HorseUpgradeEvidence.ts`: an in-memory aggregate keyed (UTC day, Horse user id, game variant, lane, upgrade id) with `decisions` and `invoked`. `upgradeIdsForFires` is compiled once from `HORSE_UPGRADE_LIVE_EVIDENCE` by the manifest's own needle rule (a quoted needle is one exact counter name, a backtick needle is a prefix). Off until the flush service arms it. Hard cap of 8,192 cells between drains; an increment that would open a cell beyond it is dropped and counted (`per_horse_evidence_cell_dropped_seen`).
- One fold in the decision worker (`workerRuntime.executeFastWithUpgradeEvidence`): the FAST execution runs inside the scope, and after it returns the fired set is recorded against the request's Horse, variant and lane. Every enabled upgrade the manifest declares for that variant and lane gets the decision; the ones with a fired evidence counter also get the invocation.
- Migration `20261114002055_per_horse_upgrade_evidence_daily.sql` (new objects only, ordinary install on merge): `horse_upgrade_evidence_daily`, the receipt table `horse_upgrade_evidence_batches`, and the only writer `fn_horse_upgrade_evidence_flush(p_payload text)`, modelled on `fn_horse_brain_flush_receipt`: strict header and row validation, at most 4,096 rows and 524,288 bytes, receipt first, additive upsert in key order, an identical resend answered `replayed`, a different payload under the same batch id refused. RLS on with no policy, nothing for PUBLIC, anon or authenticated, EXECUTE for service_role only. Receipts are pruned inside the writer (64 per accepted batch, older than 40 days) and batches older than 32 days are refused, so pruning can never make a resend additive.
- `services/HorseUpgradeEvidenceFlush.ts`: every 60 seconds the aggregate is drained, split by day into batches inside the row and byte bounds, and written. Started and stopped by the decision worker beside the brain telemetry flush (`startOwnedServices` / `stopOwnedServices`), with a bounded shutdown write (no write starts unless it can end inside 15 seconds; the stop never rejects).
- `scripts/ops/per-horse-upgrade-evidence-daily.sql`: the daily read. Per upgrade, how many unretired roster Horses had decisions and how many had an invocation, counts only.

## What Is Counted

- Counted: every FAST decision whose worker execution returned, the brain-exception fallback included. One decision per Horse, variant, lane and declared upgrade.
- Not counted: an execution that threw (no decision was made), the style-shadow re-decision (it runs with the counters suspended, so its fires never reach the scope), DEEP second looks (outside the scope, telemetry off), Pineapple discards, and anything a process does outside a FAST decision.

## What Happens To A Batch

- Acknowledged (`recorded` or `replayed`): done.
- Refused by its bytes (the writer's seven `HORSE_UPGRADE_EVIDENCE_*` errors): dropped and counted (`per_horse_evidence_batch_rejected_seen`), reported, never resent.
- Function not installed (PGRST202 or 42883): nothing was written, so every queued row returns to the aggregate (still capped) and the next tick asks again. Counted every tick (`per_horse_evidence_function_missing_seen`), reported once per process. It never throws into the decision path.
- Anything else is unconfirmed: the exact bytes and batch id are kept and resent, so a write that landed with its acknowledgement lost comes back as a replay. Counted (`per_horse_evidence_write_unconfirmed_seen`), not logged. Rows are deliberately not returned to the aggregate in this case: a fresh batch id would add a landed write twice. Still unconfirmed after 60 flushes: dropped and counted (`per_horse_evidence_batch_abandoned_seen`).

## Limits, Stated

- A counter in a Horse's decision proves that decision ran the upgrade's path. It does not prove the upgrade changed the action, and it is not a per-upgrade commit record.
- Upgrades whose evidence is not a per-decision brain counter are not provable per Horse by this fold: 04 (the reservoir is built once per process and its counter is credited to the one decision that built it), 05 (a `/metrics` series and a main-process counter) and 13 (a `/metrics` series). The core row's worker-side evidence is `phase5_canonical_state`, which every FAST decision fires. Upgrades 08 and 09 fire in the main process; their per-Horse events (`noteHorseUpgradeEvent`) and the main-process flush are the second stage of this change.
- DEEP second looks are not counted, so an upgrade exercised only in a second look is invisible here.
- Not a disk spool. A worker that dies loses what it has not written: up to one 60-second interval, plus any retained batch. The table can undercount, never overcount.
- With the function missing or the database away, memory is bounded by the 8,192-cell cap plus one drain's queue; beyond it new cells are dropped and counted.
- Real rows are at least 129 bytes, so the 524,288-byte bound binds before the 4,096-row bound (about 3,600 real rows); a full drain is four or five batches, all written in the same tick.
- The six `per_horse_evidence_*_seen` counters fire from files the ledger contract test does not scan yet; their `HorseDataLedger.ts` rows land with the second stage.

## Regression

- `HorsePerHorseUpgradeEvidence.law.test.ts` (real worker runtime, real brain, controller-dealt states): two Horses in different variants and lanes produce rows with their own ids, lanes and upgrade ids, and `invoked` equals the upgrades whose counters the same decision fired for the fleet; an execution that throws records nothing and leaves nothing for the next Horse; the same request gives the identical FAST_RESULT (decision, receipts, RNG before and after) with the scope collecting and with a pass-through; one scope and one fold in the worker, DEEP outside; the needle rule for every enabled upgrade.
- `HorseUpgradeEvidence.test.ts`: scope collection, suspension, nesting and throw hygiene; declared baseline against invocation; Horse, variant, lane and day separation; identity refusal; unarmed no-op; the cell cap; additive restore inside the cap.
- `HorseUpgradeEvidenceFlush.test.ts`: header shape and row order; split inside rows and bytes with one day per batch; per-tick bound; unconfirmed resend of the same bytes; malformed acknowledgements; each deterministic refusal; abandonment at the attempt cap; function-missing restore; the 60-second timer, shutdown order, shutdown budget and quiet degradation.
- `scripts/ci/test-per-horse-upgrade-evidence.py` (PostgreSQL 17, workflow `per-horse-upgrade-evidence.yml`): fail-before, additive upsert, replay, collision, oversize and malformed refusals, the day window and expiry, row validation, receipt pruning, privileges and the operations read.
