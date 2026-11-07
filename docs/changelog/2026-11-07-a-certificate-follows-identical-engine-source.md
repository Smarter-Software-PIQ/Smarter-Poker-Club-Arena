# A certificate follows identical engine source

**Date:** 2026-11-07
**Scope:** `.github/workflows/backup-engine.yml` (plan job), new
`scripts/ci/engine-source-identity.sh`, law
`tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`,
`PUBLISHING.md` Backup section, `docs/laws.d`.

## The problem

Every push to main that touches `server/**` queues a Backup Engine
certification: build the image, boot it, crash it, watch it recover, soak it
for 1,800 seconds, judge. About forty-five minutes on the one Backup host,
serialized. Most of those pushes do not change a byte the image is built
from. Measured on the 124 first-parent commits before this change that
touched `server/`, 21 (17%) left the engine image inputs untouched: standby
scripts, `server/tests`, release-window tooling, documentation beside the
code. Each spent the host for nothing, and the 04:00 cutover still accepts
only an exact-SHA `backup-engine/certified = success`, so a docs-only commit
on top of a certified engine had no certificate until it had been rebuilt
and soaked as if it were new.

## What the engine image is built from

`server/standby/standby-engine.sh` builds with `git archive <sha> server` as
the Docker context and `server/Dockerfile` as the recipe. The image can
therefore contain only the Dockerfile and the sources of its `COPY`
instructions that read from the context (not `--from=` a builder stage).
Today that is `package.json`, `package-lock.json`, the three tsconfig files,
`src/`, `release-evidence/`, the two native kernel sources and five build
scripts. The base image is pinned by digest and `npm ci` is pinned by the
lockfile, so identical inputs build an identical engine.

Two things that look like they should be excluded are deliberately kept:

- **Test files under `server/src`.** `COPY src/ ./src/` ships them and
  `kernelRollbackQualification.ts` hashes some of them at runtime into policy
  digests, so a test edit under `src/` can change engine behaviour. They are
  in the identity. (`server/tests`, `server/sim`, `server/qualification` are
  never copied and are not.)
- **`release-evidence/`.** Read at boot by `repositoryEvidenceReader`.

Two things are excluded: the `GIT_COMMIT_SHA` build argument (a label and
environment value that differs on every commit by construction), and
`server/standby/standby-engine.sh` (the Backup host runs origin/main's copy
at certification time, not the candidate's).

## The identity script

`scripts/ci/engine-source-identity.sh <sha>` prints one sha256 over a
manifest of: its own blob id at that commit, the Dockerfile's blob id, and
the git object id (blob or tree) of every context `COPY` source, read from
the Dockerfile **at that commit** after joining continuation lines and
dropping `--chown`/`--chmod`/`--link` flags. The input list is therefore not
written anywhere a second time: a new `COPY` line widens the identity by
itself, and a change to the script changes every identity, so nothing
inherits across a change to how identity is computed. It exits 1 and prints
nothing when the commit, Dockerfile or script cannot be read: an unreadable
identity is not an identity (CLAUDE.md 10.86). It runs in 60 ms against the
full repository.

## What the plan job does now

Push events only, after the superseded check (#9906) has passed:

1. A blobless checkout of the candidate with full history (sparse to the
   identity script; the two blobs it reads per commit are fetched on demand).
2. Compute the candidate's identity. Walk main's first-parent line back 60
   commits. An ancestor whose identity cannot be read (it predates the
   script) is passed over without a GitHub call. An ancestor with a
   **different** identity is passed over without a GitHub call.
3. For an ancestor with the **same** identity, read its newest
   `backup-engine/certified` state with the same selector the receiver and
   stage use. `success` inherits. `missing` or `pending` keeps walking.
   `failure`, `error` or an unreadable read stops the walk: a disagreeing or
   unknown witness about identical bytes is never argued past.
4. Inheriting writes `backup-engine/certified = success` on the candidate with
   description `Inherited from <certified sha>: identical engine source
(<identity prefix>)` and a `target_url` of the run, writes a step summary,
   and plans nothing (empty `sha` output, exactly as the superseded path):
   refresh and certify are skipped and the Backup host is free. If the
   status write fails, the run certifies in full.

Dispatch, schedule and post-seal (`workflow_run`) runs never inherit; they
build as before. `stage-engine-release.yml` and `auto-deploy-hetzner.yml`
read only `state`, so an inherited certificate selects and admits like an
earned one; the description makes the inheritance visible to a human tracing
it (PUBLISHING.md's trace recipe prints it).

## Tiered soak: assessed, not built

A shorter soak for "peripheral" server changes was considered and is not
built, for a reason that is structural rather than cautious:

- The classifier in `stage-engine-release.yml` distinguishes only
  "runtime" from "not runtime" by pathspec (`server/**` minus tests, sim and
  qualification). It has no notion of engine-core versus peripheral, and
  nothing in the tree gives one: the engine is one Node process plus horse
  decision workers, `release-evidence/` is read at boot, and the Horse phase
  authorities hash arbitrary listed source files (including test files) into
  the digests that decide whether a phase is live. A file that does not reach
  the image is not peripheral, it is absent, and that case is now handled
  completely (no build, no soak) by inheritance. A file that does reach the
  image is loaded by the same process whose crash-free uptime, restart count,
  memory growth and dealing rate the soak measures.
- The soak's verdicts are whole-process properties over time (`restarted_
during_soak`, `no_hands_dealt_during_soak`, bounded RSS growth). There is
  no partial version of "stayed up for thirty minutes" that a smaller change
  earns, and the two 1,800-second figures in the standby scripts (soak, and
  the freeze-trial wait) are the ones the owner's cutover evidence is built
  on. Shortening either for a class of change nobody can define from the
  tree would be a weaker certificate with the same name.

So the tiers are two: identical image inherits, different image soaks 1,800
seconds. The law pins `standby-engine certify $SHA 1800` unchanged.

## Not changed

- The superseded-run check still runs first and still wins: a superseded
  push run neither builds nor inherits.
- No status is ever written for a run that did not inherit; a candidate the
  walk could not vouch for goes to full certification exactly as before.
- The Backup host, the live engine and production data were not touched by
  this change; it is a workflow plan step and a read-only git script.

## Tests

`tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts` runs the
real identity script and the real inherit step against a temporary git
repository with a stubbed `gh`: deterministic identity that names only the
COPY set, the Dockerfile and itself; identity changes on every enumerated
input (including a test under `src/`, the lockfile, evidence, a widened
Dockerfile, the script itself) and on nothing outside them; inherits from
the nearest identical success past a missing verdict without asking about a
different identity; refuses on failure, error, unreadable statuses, an
unwritable status and an unreadable candidate; passes over ancestors that
predate the script; push-only eligibility after the superseded check;
dispatch, schedule and workflow_run never inherit.

## Found on the way: a hook's `GIT_DIR` was failing other people's tests

Pushing this branch from a Mac worktree was refused by eleven cases in
`server/src/benchmark/phase8StrengthAssemble.test.ts` and
`IncrementalPressureQualification.test.ts`, and by the new fixture tests
here, all with `fatal: this operation must be run in a work tree`. None of
those tests was wrong and none of them was touched. Git exports `GIT_DIR`
(from a linked worktree, `GIT_COMMON_DIR` too) to every hook, and the
pre-push hook selects every server test that mentions `.github/workflows`
for a workflow-only change; a `git` spawned from `server/` or from a
fixture under `$TMPDIR` then follows the pointer at this repository's
metadata and refuses. Several law tests had each learned to strip `GIT_*`
themselves; the benchmark readers had not, so the trap stayed one level up
(CLAUDE.md 10.86 rule 4).

`.husky/pre-push` now unsets `GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
GIT_PREFIX` before its first check. The hook's own git finds the tree from
its working directory. Pinned in
`tests/the-mac-push-runs-the-checks-like-ci.law.test.ts`: the block exists,
names the four variables, precedes the first guard, and `git rev-parse
--show-toplevel` still resolves after it with a hostile `GIT_DIR` set.
