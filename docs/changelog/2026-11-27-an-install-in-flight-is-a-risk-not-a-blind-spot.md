# An Install In Flight Is A Risk, Not A Blind Spot (2026-11-27)

Lane: release custody (engine cutover every three hours). A follow-up to O36b (`#12254`). Read-only tool only: `scripts/release/three-hourly-readiness.py`.

## What Was Wrong

1. **An unfinished Apply run made the whole report UNKNOWN.** Any Apply Merged Migration run in the 48-hour list that was queued, waiting or running raised a read error. Apply runs can queue for up to 900 s behind their concurrency group, so a readiness post that landed during an install could not say anything, exactly when it mattered most. It also hid the useful fact: which file was being installed.
2. **A finished Apply run after a copy was unread too.** Since `#12251` (merged 18:18 CST today) every Apply run has a second job, `Report a refused install`, which is skipped when the install succeeds. GitHub keeps no log for a skipped job and answers HTTP 404 (run `46091917200`, job `140816561035`). Readiness read every job's log, so it was UNKNOWN whenever any install landed after the copy. Measured live at 19:42 CST against Backup run `46085911560`.
3. **The copy was dated by its restore, not by its export.** `database.restoredAt` is when the copy was restored on Backup, after production was dumped. An install that committed between the dump and the restore read as already in the copy.

## What The Certificate Holds

The certificate artifact (`backup-certificate-<sha>-<attempt>`, read from Backup run `46085911560`) is a zip with `certificate.json`, `compatibility.json` and `schema-evidence.json`. `certificate.json`'s `database` block carries `restoredAt`, `dump`, `dumpSha256`, `schemaEvidenceValidated` and `schemaEvidenceSha256`. It has no dump time of its own. `schema-evidence.json` carries `capturedAt`, `dumpSha256` and `migrations`, the installed `[version, name]` set the dump was proved to be taken under (7,718 rows in that run). `backup-engine.yml` captures it after `pg_dump` and compares it equal to a capture taken before the dump, or exports again. In that run `capturedAt` was 16:14:43 CST and `restoredAt` 16:15:45 CST.

The selector (`scripts/ci/select-daily-engine.py`, through `judge()` in `server/scripts/engine-release-installed-migrations.py`) never dates the copy. It compares the copy's retained evidence set with production's installed set read at selection, modulo the engine-inert carve-out. `restoredAt` matters only to readiness.

## Each Fix

1. **Pending installs.** An unfinished Apply run is the pending install of the one file its run-name (`Apply Merged Migration <file>[ <nonce>]`) and its job (`Apply <file>`) name. When the file is engine-inert by the selector's own helper (`inert_versions` and `bounded_inert`), or the copy's evidence already holds its version, it changes nothing and the fresh note says so. Otherwise the candidate is `AT_RISK` (exit `0`): `<sha12> is certified and selectable now, but an install is in flight that the Backup copy read from production <time> lacks: <file> (Apply Merged Migration run <id>, <status>); if it commits before the cutoff the selector refuses this certificate and the cycle needs a fresh-copy Backup run`. A run that names no file, two different files, or one that is not a migration file, or that has any other unfinished job, stays UNKNOWN. A committed install the copy lacks still makes the certificate stale, whatever is in flight beside it. If the apply job has finished and only the refusal report is still running, the apply log is read as before.
2. **Skipped jobs.** The refusal report never installs, and a skipped job ran nothing: neither log is read.
3. **Dating.** When the archive carries schema evidence bound to the certificate (its sha256 is `schemaEvidenceSha256` and it names the same dump), the copy is dated by the earlier of `capturedAt` and `restoredAt`. Evidence that is not bound is UNKNOWN. With no evidence file, the copy is dated by `restoredAt` as before. The evidence set also clears a committed install whose version the copy already holds.
4. **The running window installer stays UNKNOWN.** GitHub serves a job's log only after the job finishes. The installer's queue is "on main and not in production's schema_migrations", which this tool cannot read without a database identity. So the files it is sending cannot be named here.

## Where The Verdict Is Shown

- The Stage step summary prints `Readiness CLI: AT_RISK - <summary>`, which reads as written.
- The T-minus line on issue #11599 (`readiness_note` in `stage-engine-release.yml`) knows only READY, IN_FLIGHT and NO_CANDIDATE. Any other verdict prints as `readiness unknown (<summary>)`, so until that jq gets an AT_RISK branch it reads `readiness unknown (<sha12> is certified and selectable now, but an install is in flight ...)`. That is fail-closed (never READY) and names the file and the run. The workflow is a release-control path and is not touched here.

## Tests

`python3 -B tests/operations/three-hourly-readiness.test.py`: 55 tests (49 before). Against `origin/main`'s script, 5 of the 6 new tests fail and the unidentifiable-file guard passes on both. The law pin in `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts` moves to `Ran 55 tests`.

Live, read-only, from the cloud container at 19:42 CST: the certificate of Backup run `46085911560` dated its copy 16:14:43 CST from its evidence. Three installs after it (`20261127185416`, `20261127185719`, `20261127230642`) were read from their logs and left out as engine-inert, with no 404. The full CLI said `IN_FLIGHT` (eaf527c51d52 awaiting Backup run `46092699049`), so no selectable candidate was judged at that moment.
