# The Pull Request Builds What Ships (2026-11-27)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

After a merge, `engine-release-prequalification.yml` ("Compile and test the exact server tree") decides whether a commit can ever be a cutover candidate. It runs `npm run build` in server/ (the hist215 native step and an emitting `tsc`). The required `Server Engine` check on pull requests ran `tsc --noEmit` instead. On 2026-11-27 four commits merged between 04:16 and 05:07 CST passed the required check, then failed prequalification with "heap out of memory" in `npm run build`. Nothing was selectable at 06:30 and the 07:00 CST cycle kept serving. #12205 (07:13 CST, another lane) gave both builds the heap; this change closes the gap that let a pull request merge without running the build at all.

## The Change

- `.github/workflows/ci.yml`, job `Server Engine`: a new step "Build the exact server tree (as engine prequalification does)" runs `npm run build` from server/ with `NODE_OPTIONS=--max-old-space-size=6144`, on shard 1 (the build is deterministic).
- New law `tests/the-pull-request-builds-what-ships.law.test.ts`: every command the prequalification compile step runs, except `npm ci`, must also be run by the `Server Engine` job from server/, with at least the same heap for the build, and with the same test shard split. A command added to the prequalification without its pull-request twin fails CI.
- `tests/the-build-typechecks-where-it-ships.law.test.ts` and `tests/unit/requiredCiRunnerRecovery.test.ts` now name the one server build in ci.yml explicitly, and the recovery test pins the new step and refuses it missing, duplicated, moved or weakened.

No release-control file changes.

## Proof

The new law fails on unmodified main (`Server Engine does not run: npm run build`) and passes with the change. The seven related law files pass (2,176 cases). The `Server Engine` job of this pull request runs the new step for real.
