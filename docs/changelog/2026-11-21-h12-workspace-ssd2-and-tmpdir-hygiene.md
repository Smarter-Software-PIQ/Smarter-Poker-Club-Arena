# 2026-11-21: H12 Workspace SSD2 Preference, macOS TMPDIR Test Hygiene, H3 Audit & H6 Cutover Boundaries

## H12-A: `scripts/agent-workspace.sh` prefers SSD2 (`extreme-capacity`)

- **Symptom**: On the Mac, `/Volumes/SmarterWork/agent-work` is root-owned read-only, while SSD2 (`/Volumes/SmarterWork/agent-work/extreme-capacity`, the preferred external work volume under the November 9, 2026 owner storage direction and `ssd-paths.py work`) was never tried by `choose_agent_worktree_root`; it only probed `$ssd/$repo` and `$ssd/shared-capacity/$repo`.
- **Fix**: Updated `choose_agent_worktree_root` in `scripts/agent-workspace.sh` to probe `"$ssd/extreme-capacity/$repo"`, then `"$ssd/$repo"`, then `"$ssd/shared-capacity/$repo"`, requiring `[ -d "${cand%/*}" ]` before `agent_root_writable "$cand"` so an unmounted volume subdir is never fabricated inside `$ssd`, and refusing (never falling back to the internal boot disk) when `$ssd` is mounted and none of the three SSD candidates is writable.
- **Barrier**: Updated `tests/unit/agentTreesLiveOnTheSsd.test.ts` and expanded `tests/unit/agentWorktreeRootIsProvedWritable.test.ts` to assert SSD2 preference (both when `$ssd` is writable and read-only), non-fabrication of an absent `extreme-capacity` directory, fallback order, and boot-disk refusal.

## H12-B: `tests/operations/release-recovery-read.test.py` passes with default macOS `TMPDIR`

- **Symptom**: Running `python3 -B tests/operations/release-recovery-read.test.py` without `TMPDIR=/private/tmp` failed 13 cases in `ControlInventoryTests` (12 errors, 1 failure) because macOS sets `TMPDIR=/var/folders/...`, where `/var` is a symlink to `/private/var`. `ControlInventoryTests.fixture` kept the unresolved `Path(folder)`, so `_control_inventory_at` (`scripts/ci/read-scoped-release-recovery.py`) rejected `link.resolve(strict=True) != parent / 'engine-control-generations' / sha`.
- **Fix**: Resolved `parent = Path(folder).resolve()` inside `ControlInventoryTests.fixture` so test fixtures pass canonical paths under both macOS default `TMPDIR` and Linux CI, with zero change to production security assertions in `scripts/ci/read-scoped-release-recovery.py`. Also updated the vitest harness wrapper timeout in `tests/a-release-recovery-observation-reads-only-its-run.law.test.ts` from a fixed `15000` ms (which left ~1 s margin for all 196 Python tests once `ControlInventoryTests` stopped failing early) to `loadAwareTestTimeout(25_000)` (fitting inside `vitest.config.ts`'s `loadAwareTestTimeout(30_000)`).

## H3 Audit: `#11613` (`8d01508d3d4`) vs `#11617` (`09398e6ccec`)

- Verified on `origin/main` that `#11613` (`operations/release/fixture/Dockerfile` + `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts`) is strictly more resilient than `#11617`: instead of chasing Debian's moving APT index (`17.12` + `debian-pins.py`), `#11613` pins all 7 PostgreSQL `.deb` files once in `postgres-debs` (staying at `17.11-0+deb13u1`, matching `native-smoke.mjs` and `fixture-smoke.py`), fetches `deb.debian.org/debian` -> `deb.debian.org/debian-security` -> `snapshot.debian.org/file/<sha1>`, verifies SHA-256 on every file (`process.exit(1)` on mismatch), keeps `snapshot.debian.org` out of APT `sources.list`, and bind-mounts/holds/asserts identical versions across runtime and builders.
- Confirmed `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts` already tests the pool-drop fallback order, SHA-256 verification, and APT isolation. No code gap remains that warrants altering `#11613`'s design.

## H6: Remaining 3-Hourly Cutover Boundaries (`docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`)

- Audited items (a)-(e):
  - **(a)** `fn_ca_engine_cutover_watch` / `fn_ca_cutover_readiness_watch`: intentionally 04:00 anchor only (already documented; no new cron/watcher added).
  - **(b)** `fn_ca_record_break_scorecard` (migration `20261020210313`): automatically grades any of the 8 cycles that runs via `engine_maintenance_break_log`; fallback `break_never_started` synthesizes an expected end only for the 04:00 anchor (documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`).
  - **(c)** `fn_maintenance_week_report` (migration `20260902120000`): legacy ad-hoc `service_role` read-only helper (not scheduled by cron) still referencing the historical `24*window_days` / `:55-:59` hourly buckets (documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`; SQL cleanup deferred to a separate PR once `apply-merged-migration.yml` resumes).
  - **(d)** Backup freeze baseline (`scripts/ci/backup-freeze-baseline.py`): intentionally 04:00 anchor only (already documented).
  - **(e)** Pre-deploy web clients treat `three-hourly` as `"unknown"` until refreshed (`src/utils/maintenanceSchedule.ts`), suppressing predictive pre-break text while active break banners continue to render (documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`).
