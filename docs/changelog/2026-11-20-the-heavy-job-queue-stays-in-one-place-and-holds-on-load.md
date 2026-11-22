# The heavy-job queue stays in one place, holds on load, and the scan tests stop timing out under load (2026-11-20)

**What changed**

- `scripts/lib/heavy-queue.sh`: the queue's ticket folder is one fixed folder on the boot disk (`~/.cache/club-arena-heavy-queue`), whatever drives are attached. Before, it followed the SSD (SSD1 shared, else SSD2, else the boot disk). When SSD1 dropped at 5:53 PM Chicago on 2026-11-20, waiters moved to an SSD2 queue, the SSD1 tickets were stranded (the math-core gate held #121), and once SSD1 returned there were two queues of four slots each. Jobs still running from the old SSD folders are counted against the slots (read only) until those checkouts are gone.
- A free slot now also waits while the 1-minute load is above `CA_HEAVY_QUEUE_LOAD_CEILING` (default: the core count) and another heavy job is running. The first job always starts, so the queue never deadlocks; `CA_HEAVY_QUEUE_MAX_WAIT` still bounds every wait.
- Waiters are told their place and an ETA (the median of recent run lengths, kept in the queue folder's `history`). `bash scripts/heavy-queue.sh status` shows the ceiling, the typical run length and the old-folder jobs.
- `scripts/ci/load-aware-test-timeout.mjs`: the harness timeout of the root suite (`vitest.config.ts`) and of `tests/unit/postDeployE2eHonestyLaw.test.ts`'s stale-checkout case is exact on hosted CI and on an idle machine, and stretches with load (2.5 x load per core, cap 4x) on the shared Mac. No assertion, product deadline or child-process deadline changed.

**Why**

The PLO math-core pre-push gate failed three runs in a row on three different file-scanning tests that its branch never touched (`law-registry` 64.4 s, `a-revoke-from-anon-must-name-public` 48.3 s, `postDeployE2eHonestyLaw` 20.0 s), while four admitted gates and other work kept the load at 23-53 on 28 cores.

**Tests**

`tests/operations/heavy-queue.test.mjs` (serialization, FIFO, stale-ticket recovery, load hold, both slots under the ceiling, old-folder jobs, ETA and run history, the fixed folder), wired into `ci.yml`; `tests/unit/loadAwareTestTimeout.test.ts`.
