# 2026-11-05 - Horse observer memory is bounded by use, not by arrival

## What was measured

Engine 71087373 on engine-01, 4.7 hours after boot: process RSS 11.4 GB and
rising about 1.3 GB an hour. The main isolate held 1.5 GB (flat; its history
cache is capped at 512 MB and full), the 14 equity workers 10 MB each, the
journal writers 40 MB each. The eight Horse decision workers held 583 to
937 MB of old space each, 5.4 GB in all, rising about 90 MB per worker per
hour with no plateau. A six-minute allocation sampling profile on worker 0
retained almost nothing from the live decision path, so the growth was in
state that outlives hands.

## Where it was

`HorseObserverReads.entries` in `server/src/engine/horseDecision/observerReads.ts`:
one private HorseMind sandbox per horse, variant, format and dealt count, up
to 2048 per worker. Every shard learns every completed hand on the floor into
every existing entry the hand's observer participants name. Three things made
that unbounded:

1. The per-entry capacity caps (512 stats, 8,192 seen actions, 8,192 hand
   flags, 2,048 pairs and so on) were checked only in `run()`, when the horse
   decided. An entry whose horse stopped deciding on that shard (moved tables,
   changed dealt count, sat out, or was routed elsewhere) kept learning
   through `complete()` with no cap, up to the live-mind caps of 60,000 seen
   actions, 20,000 hand flags and 20,000 pairs, 10 MB and more each.
2. Eviction was first-in first-out by creation, so those departed entries were
   the ones that stayed longest.
3. 2048 such entries per worker is the 600 to 900 MB measured.

## What changed

- An entry that has not decided a hand for `idleMs` (20 minutes by default,
  longer than any tournament break or seat move) stops learning: the next
  completion that names it evicts it, and a sweep every 64 completions evicts
  the rest. A returning horse starts a fresh entry, as it always did after an
  eviction.
- `complete()` applies the same capacity reset `run()` applies, where the
  growth happens.
- The map is least-recently-run: a decision moves its entry to the tail, and
  pressure evicts the horse that stopped deciding first, after sweeping idle
  entries.
- `/metrics` publishes `poker_horse_decision_worker_heap_used_bytes{shard}`
  and `poker_horse_decision_worker_heap_total_bytes{shard}` from each
  worker's STATUS sample, so the next climb names its isolate.
- Law test `observerMemoryIsBoundedByUse.law.test.ts`.

## Acceptance on production

On a 24-hour run with the daily window only: engine RSS flat within 500 MB
after the first hour, no worker old space above 450 MB, total RSS under 8 GB.
