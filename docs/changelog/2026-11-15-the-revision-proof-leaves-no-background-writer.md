# The selected-revision proof leaves no background writer (2026-11-15)

## What broke

`Confirm The Hetzner Web Publish Reached Production` (post-deploy-e2e.yml,
step `The source run is the exact publisher on protected main`) failed after
its own proof had passed:

    Selected revision 10d56d98... is on protected main.
    rm: cannot remove '/tmp/tmp.s0a4eVoTU1/.git': Directory not empty

Runs 43555229653, 43667942070 and 43678854398 (also `.git/objects` variants).
A failed gate skips every lane, so each of these was recorded as
`PostDeployVerificationIncomplete` with "nothing verified".

## Root cause

`scripts/ci/selected-revision-is-on-main.sh` fetches protected main into a
throwaway repository and deletes it in an `EXIT` trap. After any fetch, git
runs `git maintenance run --auto`, and since Git 2.47 (`maintenance.autoDetach`,
default true) that runs DETACHED. The runner image (ubuntu-26.04) ships git
2.56.1, which starts `git maintenance run --auto --quiet --detach`, which then
runs `git commit-graph write --split --reachable` in the background after the
fetch has returned. Measured locally with git 2.56.1 built from source against a
20,000-commit fixture: `objects/maintenance.lock` was still held when the trap
ran in 20 of 20 runs, and `rm -rf` reproduced the exact production message under
CPU contention.

## Fix

The throwaway repository refuses automatic maintenance in its own config
(`maintenance.auto false`, `gc.auto 0`), and the fetch carries
`--no-auto-maintenance`, which inherited configuration cannot override. After
the fix, the lock was held at cleanup in 0 of 20 runs and the trace shows no
maintenance child. The ancestry proof and its refusal are unchanged.

Pinned by `tests/unit/selectedRevisionProofLeavesNoBackgroundWriter.test.ts`:
it runs the real script against a local bare repository with `GIT_TRACE2_EVENT`
and requires no `maintenance run` or `gc` child (also with maintenance forced on
through inherited config), a clean `TMPDIR` afterwards, and the unchanged
refusal of a revision that is not on main. It fails 3 of 4 cases against the
previous script on git 2.43 and on git 2.56.1.

## What this does not change

This removes one of the causes of the open `PostDeployVerificationIncomplete`
episode (operational alert 371597, reliability incident 838c2142), the one that
fired as "nothing verified" at critical severity. The episode can only close on
a run in which every owed lane passes. In the 170 Post-Deploy E2E runs from
2026-11-13 to 2026-11-15, that never happened: no lane was ever counted as a
failure for being replaced (the recorder already calls a zero-step cancelled
lane `replaced` and records nothing for it), but the client browser lane failed
17 of the 18 times it ran and the live-table lane failed 39 of 69. Those are
failing production specs, each with its own cause, and are listed in this
task's report.
