# Which Horse Exercised Which Upgrade Is On The Record

The brain counters (`BrainTelemetry.noteFire`) are fleet totals with no Horse identity, so "which of the 1,000 Horses exercised which approved upgrade" had no durable answer: `horse_brain_telemetry` says an upgrade's counter fired, `horse_brain_activity_rollup` says a Horse decided, and nothing joined the two. This adds a permanent per-Horse record.

Measurement path only: no decision, wager, think time, queue or deadline changes. Pillar 2, R7/R8 and both held-out packs stay off.

## What A Row Means

`horse_upgrade_evidence_daily` holds one row per (UTC day, Horse user id, game variant, lane, upgrade id):

- `decisions` is the number of opportunities: the FAST brain decisions that Horse made in that variant and lane (written by the decision worker to every enabled upgrade the manifest declares for that variant and lane), plus that Horse's host-side opportunities for the upgrade (a run-it-twice choice or answer, an insurance offer, a purged pre-action), written by the main process.
- `invoked` is the opportunities among them in which the upgrade was exercised: the brain decisions in which at least one of the upgrade's evidence counters fired (`HORSE_UPGRADE_LIVE_EVIDENCE`), plus every host-side opportunity.
- No opportunity is reported twice. A host counter that describes a brain decision (kill-pot or seven-deuce context on a decision request, `upgrade08_kill_pot_seen` and `upgrade08_seven_deuce_seen`) records no per-Horse event: that decision is counted once, by the worker, and since #10760 the brain's own reads (`upgrade08_kill_pot_orbit_seen`, `upgrade08_kill_pot_unopened_seen`, `upgrade08_seven_deuce_overlay_seen`, `upgrade08_seven_deuce_bounty_seen`) fire inside its scope and make it invoked. The three insurance answer counters record no event either: they are the offer answered, and the offer was the event. So `invoked` never exceeds `decisions`, in a batch or in the table.
- A Horse seat that a person's own client pilots records no host event (the run-it-twice, insurance and purge sites all require a server-owned seat), and a person never does.

## What Changed

- `BrainTelemetry.withDecisionFireScope(fn)`: while `fn` runs, every counter `noteFire` counts is also collected into a per-decision set (after `noteFire`'s existing enabled check, so a suspended evaluation or a process with telemetry off adds nothing). Restores the previous scope in a `finally`; a nested call hands its keys to the outer scope.
- `engine/HorseUpgradeEvidence.ts`: the in-memory aggregate. `upgradeIdsForFires` is compiled once from `HORSE_UPGRADE_LIVE_EVIDENCE` by the manifest's own needle rule (a quoted needle is one exact counter name, a backtick needle is a prefix). Off until the flush service arms it. Hard cap of 8,192 cells between drains; an increment that would open a cell beyond it is dropped and counted.
- One fold in the decision worker (`workerRuntime.executeFastWithUpgradeEvidence`): the FAST execution runs inside the scope, and after it returns the fired set is recorded against the request's Horse, variant and lane.
- Host events (`noteHorseUpgradeEvent`, main process), one per opportunity, beside the fleet counter already there: the run-it-twice chooser and each answering Horse and the insurance offer (`ServerTableEngineRunout.ts`), the pre-action purge of a server-owned seat (`ServerTableEngineTurns.ts`, `LightningHandHost.ts`). Each site first asks whether the aggregate is armed, so an unarmed process reads nothing for it.
- Migration `20261114002055_per_horse_upgrade_evidence_daily.sql` (new objects only, ordinary install on merge): the daily table, the receipt table `horse_upgrade_evidence_batches`, and the only writer `fn_horse_upgrade_evidence_flush(p_payload text)`, modelled on `fn_horse_brain_flush_receipt`: strict header and row validation, at most 4,096 rows and 524,288 bytes, receipt first, additive upsert in key order, an identical resend answered `replayed`, a different payload under the same batch id refused. RLS on with no policy, nothing for PUBLIC, anon or authenticated, EXECUTE for service_role only. Receipts are pruned inside the writer (64 per accepted batch, older than 40 days) and batches older than 32 days are refused, so pruning can never make a resend additive.
- `services/HorseUpgradeEvidenceFlush.ts`: every 60 seconds the aggregate is drained, split by day into batches inside the row and byte bounds, and written. Each decision worker starts and stops it beside its brain telemetry flush (`startOwnedServices` / `stopOwnedServices`); the main process starts it beside its own (`index.ts`) and stops it in the same parallel stop (`GameServer.ts`).
- `HorseDataLedger.ts`: six receipt rows (below), and the ledger contract test now scans the two new source files, so a new key there without a row fails the build.

## The Daily Read

`psql "$DATABASE_URL" -X -v day=2026-11-14 -f scripts/ops/per-horse-upgrade-evidence-daily.sql` returns one line per upgrade, counts only, no Horse ids: the unretired roster (`profiles.is_horse`, not deleted, on `ca_horse_fleet_register` with `retired_at` null, the roster the daily brain-coverage record uses), how many of those Horses had `decisions > 0`, how many had `invoked > 0`, and the day's totals. Read-only, never scheduled.

## What Is Counted

- Counted: every FAST decision whose worker execution returned, the brain-exception fallback included; and each host-side opportunity above.
- Not counted: an execution that threw (no decision was made), the style-shadow re-decision (it runs with the counters suspended, so its fires never reach the scope), DEEP second looks (outside the scope, telemetry off), Pineapple discards.

## What Happens To A Batch

- Acknowledged (`recorded` or `replayed`): done.
- Refused by its bytes (the writer's seven `HORSE_UPGRADE_EVIDENCE_*` errors): dropped and counted (`per_horse_evidence_batch_rejected_seen`), reported, never resent.
- Function not installed (PGRST202 or 42883): nothing was written, so every queued row returns to the aggregate (still capped) and the next tick asks again. Counted every tick (`per_horse_evidence_function_missing_seen`), reported once per process. It never throws into the decision path.
- Anything else is unconfirmed: the exact bytes and batch id are kept and resent, so a write that landed with its acknowledgement lost comes back as a replay. Counted (`per_horse_evidence_write_unconfirmed_seen`), not logged. Rows are deliberately not returned to the aggregate in this case: a fresh batch id would add a landed write twice. Still unconfirmed after 60 flushes: dropped and counted (`per_horse_evidence_batch_abandoned_seen`).
- The other two receipts: `per_horse_evidence_cell_dropped_seen` (the cap) and `per_horse_evidence_identity_refused_seen` (a user id that is not a uuid). All six have no floor; zero is the normal state, and a positive value on a day means the table undercounts that day for the process that fired it.

## Shutdown Time

The flush's stop resolves within 15,000 ms of being called (`HORSE_UPGRADE_EVIDENCE_SHUTDOWN_BUDGET_MS`). Every write carries a 5,000 ms abort; once the stop has begun no write starts unless it can end inside the budget, and that holds for a tick already in flight as well as for the stop's own writes. The stop never rejects and holds no lease.

It adds no serial time in either process, because in both it runs in the parallel slot the telemetry stop already occupies:

- Decision worker: journal stop (up to 5,000 ms), then `Promise.all` of the brain telemetry stop (up to 20,000 ms), mind persistence and this stop (up to 15,000 ms). The slot is still bounded by the telemetry stop: 5,000 + max(20,000, 15,000) = 25,000 ms, unchanged.
- Main process: the worker stop above (25,000 ms), the main telemetry stop (20,000 ms) and this stop (15,000 ms) are one `Promise.all`: 25,000 ms, unchanged.
- With the between-hands drain ahead (up to 12,000 ms): 12,000 + 25,000 = 37,000 ms of the engine's 40,000 ms graceful deadline, the same as before this change.

The 12,000, 5,000 and 20,000 ms figures are the existing stops' own bounds, not re-measured here; mind persistence shares the slot and is not bounded by this change.

## Merge Timing And Rollout Order

- The migration installs on merge and changes production's installed migration set. It therefore merges after an engine cutover has sealed, or before the Backup export for the next release is taken, never between a release's certification and its cutover.
- Order: (1) merge, the migration installs, the function exists and nothing calls it; (2) the next engine release carries the code, and the engine-doors check finds the function before the release is handed over; (3) each worker and the main process start writing within a minute of boot; (4) the daily read is meaningful from the first full UTC day after that cutover.
- An engine that serves before the function exists degrades quietly: rows are held in memory under the cap, the missing function is counted every minute and reported once, and no decision is touched. Nothing needs to be reverted in the database to roll the engine back; the tables simply stop growing.

## Limits, Stated

- A counter in a Horse's decision proves that decision ran the upgrade's path. It does not prove the upgrade changed the action, and it is not a per-upgrade commit record.
- Upgrades whose evidence is not a per-decision brain counter are not provable per Horse here: 04 (the reservoir is built once per process and its counter is credited to the one decision that built it), 05 (a `/metrics` series and a main-process counter with no Horse in scope) and 13 (a `/metrics` series). Their rows carry the decision baseline with `invoked` at zero. The core row's worker-side evidence is `phase5_canonical_state`, which every FAST decision fires.
- For upgrades 08 and 09 `decisions` mixes two kinds of opportunity (brain decisions and host-side offers), so `invoked / decisions` is not a rate of anything; the meaningful reading is which Horses have `invoked > 0`.
- DEEP second looks are not counted, so an upgrade exercised only in a second look is invisible here.
- Not a disk spool. A process that dies loses what it has not written: up to one 60-second interval, plus any retained batch. The table can undercount, never overcount.
- With the function missing or the database away, memory is bounded by the 8,192-cell cap plus one drain's queue; beyond it new cells are dropped and counted.
- Real rows are at least 129 bytes, so the 524,288-byte bound binds before the 4,096-row bound (about 3,600 real rows); a full drain is four or five batches, all written in the same tick.

## Regression

- `HorsePerHorseUpgradeEvidence.law.test.ts` (real worker runtime, real brain, controller-dealt states): two Horses in different variants and lanes produce rows with their own ids, lanes and upgrade ids, and `invoked` equals the upgrades whose counters the same decision fired for the fleet; a decision in which the brain read the seven-deuce game is one decision and one invocation of upgrade 08; an execution that throws records nothing and leaves nothing for the next Horse; the same request gives the identical FAST_RESULT (decision, receipts, RNG before and after) with the scope collecting and with a pass-through; one scope and one fold in the worker, DEEP outside; no host event beside a decision-request counter or an insurance answer, and exactly one beside each host opportunity; both processes start the flush with their telemetry and stop it in the parallel slot; the needle rule for every enabled upgrade.
- `HorseUpgradeHostEvidence.test.ts` (the production methods): run-it-twice chooser and answers, the insurance offer and its answer, the table purge and the Lightning purge each record one event for the right Horse, variant and lane, and nothing for a person or a person-piloted seat.
- `HorseUpgradeEvidence.test.ts`: scope collection, suspension, nesting and throw hygiene; declared baseline against invocation; worker decisions and host opportunities adding into one cell; Horse, variant, lane and day separation; identity refusal; unarmed no-op; the cell cap; additive restore inside the cap.
- `HorseUpgradeEvidenceFlush.test.ts`: header shape and row order; split inside rows and bytes with one day per batch; per-tick bound; unconfirmed resend of the same bytes; malformed acknowledgements; each deterministic refusal; abandonment at the attempt cap; function-missing restore; the 60-second timer, shutdown order, the shutdown budget with a slow writer (own writes and a tick in flight), the 5,000 ms write abort, and quiet degradation.
- `HorseDataLedger.test.ts`: the six receipts are declared and fired, with the two new files in its scan.
- `scripts/ci/test-per-horse-upgrade-evidence.py` (PostgreSQL 17, workflow `per-horse-upgrade-evidence.yml`, the one-workflow-per-script pattern of `per-horse-brain-coverage.yml`): fail-before, additive upsert, replay, collision, oversize and malformed refusals, the day window and expiry, row validation, receipt pruning, privileges and the operations read.
