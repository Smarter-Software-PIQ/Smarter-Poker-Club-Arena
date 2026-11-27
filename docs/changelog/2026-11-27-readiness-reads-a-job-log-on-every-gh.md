# Readiness Reads A Job Log On Every gh (2026-11-27)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

At T-90m and T-45m of the 16:00 CST cycle on 2026-11-27 the readiness post on `#11599` said `readiness unknown (a044fa566044 is certified, but whether its Backup copy is current could not be read: gh api GET .../actions/jobs/140694717988/logs failed: the response contains terminal escape sequences ...)`. The candidate was fresh; it sealed at 16:00. The early warning was blind for the whole cycle.

O36 (`#12218`) reads the applier's job logs with `gh api --method GET`. A job log carries terminal colour codes. gh from 2.97 refuses to print a non-JSON body that holds them unless it is passed `--allow-escape-sequences`. The hosted runner has that gh; the Mac (2.86), where the O36 replay was run, prints them and does not know the flag. The fix was proved on one gh and ran on another.

## The Fix

`gh_api_get_text` in `scripts/release/three-hourly-readiness.py` always asks with `--allow-escape-sequences`, because the log is parsed as data and never written to a terminal. Only the answer `unknown flag: --allow-escape-sequences` (an older gh, refused before any request is made) selects the old form. Any other failure is still unread, so the verdict is still UNKNOWN (CLAUDE.md 10.86), and it is asked once.

`committed_files_in_log` removes colour codes before it matches a line, so a coloured `[apply]` line is still a committed file.

## Proof

- `tests/operations/three-hourly-readiness.test.py`: 33 cases pass, 4 new (`JobLogReaderTests`). On main the same 4 fail (`gh_api_get_text` takes no runner, and a coloured line is not matched).
- First live proof: the readiness posts of the 19:00 CST cycle on `#11599`; recorded in `docs/ops/cutover-fix-verification-and-hardening.md`.

## Other Readers Of A Job Log

`scripts/ci/migration-apply-refusal-alert.mjs` (`apiText`) reads a job log through `gh api` the same way. It is a release-control file, so its change merges in a merge window, in its own pull request. `certification-failure-streak.mjs`, `pr-status.mjs` and `public215-source-admission.mjs` use `fetch` and are not affected. Artifact archives (`gh api .../zip`) were read correctly by the same runs.
