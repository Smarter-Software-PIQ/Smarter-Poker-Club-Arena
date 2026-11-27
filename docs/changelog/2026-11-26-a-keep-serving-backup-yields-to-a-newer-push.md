# A Keep-Serving Backup Yields To A Newer Push Run (O27c)

Date: 2026-11-26 (Chicago). Lane: release-custody. Found by the hostile audit of the O27/O27b, O29, O32, CR1 and shorter-certification merges (#12083, #12103).

## What Broke

The first live "Backup after keep-serving" run after O27b merged, run 45883490551 (cycle 2026-11-26T13, dispatched 13:25 CST by Stage owner run 45866579894), was admitted correctly: its dispatch intent was proved and refresh started. It then waited for the exclusive Backup host turn for the full 120-minute ceiling:

- 13:25 CST, behind the manual run 45876595076;
- 14:02 CST, behind push run 45885658741 (2238a16342de, newer main);
- 14:44 CST, behind push run 45892895834 (396283f68a7f, newer main), which certified the build that sealed the 16:00 CST cycle.

At 15:25 CST it timed out (refresh job 140128382033), certify wrote `backup-engine/certified = error` on d99330ffd5ef ("never held the Backup host turn"), and `keep-serving-outcome` turned the run red with "KEEP-SERVING BACKUP CERTIFIED NOTHING" (job 140177040093). Nothing was blocked, because the run never held the lease, but the run reported a failure for work that newer push runs had already done, and its only purpose (a certificate of main for the next cycle) was already met.

## Why

The supersession-while-waiting rule in the refresh `turn` step and the mid-soak yield in the certify step apply only when `EVENT = push` or `POST_SEAL = 1`. The keep-serving run is a `workflow_dispatch` with `after_cycle` and no `sha`, so neither rule saw it, although it certifies main for the next cycle exactly like a post-seal next-candidate run (O24), which already yields.

## The Fix

`.github/workflows/backup-engine.yml`: both gated steps get `KEEP_SERVING` (`'1'` only for a `workflow_dispatch` with `after_cycle` set and `sha` empty), and both gates read `push || POST_SEAL || KEEP_SERVING`. A waiting keep-serving run now yields to a strictly newer active push run with a different engine identity or projection, without the lease and without a status; `refresh.outputs.deferred` is `1`, certify is skipped, and `keep-serving-outcome` reports the documented "handed the Backup host back (deferred)" outcome in green. Stage's O27b check still reads refresh as admitted. A person's dispatch without `after_cycle`, a freeze baseline and a booking still never yield.

## What Stops It Returning

`tests/the-post-seal-backup-certifies-the-next-candidate.law.test.ts` now pins the gate text with `KEEP_SERVING`, runs the real `turn` step for a keep-serving run (yields, no lease, no status) and for a manual dispatch (waits and acquires), and pins the `KEEP_SERVING` expression on both steps.

## Verified OK In The Same Audit (No Change)

- O32 `cycle-look-back` ran in every eligible Stage run from 12:40 CST (run 45877789848) on and posted one NO OWNER line for the 10:00 CST cycle at 12:40:32 CST; later runs posted nothing for it.
- CR1 `cutover-outcome-record` ran in the 16:00 CST owner run 45889489757 (job 140178704045): recorded `2026-11-26T16: selected` and the 10:00 CST `no-owner` gap, ledger artifact 15154243761. Note: the record is taken from the selection at cycle minus 30 minutes, so a receiver refusal after selection is not a ledger refusal; that is the CR1 design as written.
- The 16:00 CST cycle sealed 396283f68a7f on a 900-second certificate (`soak_is_sufficient`), so the shorter certification is accepted end to end.
- Red Stage run 45877789848 was the release-control merge #12103 landing at 12:40 CST, 20 minutes before the 13:00 cycle ("Release controls changed during reservation; keep serving"): a custody timing issue, not a code defect.
- Backup certify failures between 07:00 and 14:00 CST were real refusals (rollback rehearsal, hand-gap ceiling), already in the custody notes on issue #11599.
