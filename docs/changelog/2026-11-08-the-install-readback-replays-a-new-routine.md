# The Install Queue Reads Back A Migration That Creates New Routines (2026-11-08)

**What happened.** Migration `20261107224538_v31_public215_feature_contract_v2` installed correctly (dry and real `apply-merged-migration.yml` runs succeeded, its `@live-proof` was true), but the ops install queue marked the job failed: `verification failed: no readback ... function "fn_gto_v31_public215_feature_schema" already exists`.

**Root cause.** `operations/ops-mac/readback.py` replays every routine definition of the merged file inside a rolled-back transaction and compares md5s. It replayed `CREATE FUNCTION` verbatim. A new routine created with plain `CREATE FUNCTION` now exists in production, so the first replayed statement raised, the transaction aborted, and no `readback|` line was printed. It also matched `CREATE` text inside a DO block's quoted `EXECUTE` string, which is not a statement the file runs.

**Fix.** The replay rewrites a plain `CREATE FUNCTION/PROCEDURE` to `CREATE OR REPLACE` (the same definition check), and only top-level statements (line start) are replayed. Test: `tests/ops-mac-services.test.ts` with fixture `tests/fixtures/ops-mac-readback/plain-create-and-patch.sql`.

**Verified on production (read-only, rolled back), 01:10Z:** the old readback of `20261107224538` errors exactly as the queue saw; the new readback prints `readback|5|5|` and `liveproof|t`.

The running queue on the ops Mac uses `~/.smarter-poker/ops/readback.py`, installed by `operations/ops-mac/setup.sh`; it picks this change up when setup is re-run after merge.
