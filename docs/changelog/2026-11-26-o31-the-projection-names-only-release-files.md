# The Release Projection Names Only Release Files (O31, 2026-11-26)

## Why It Broke

`projection(sha)` in `scripts/ci/read-engine-prequalification.py` lists the release-control files of a commit. The selector (`scripts/ci/select-daily-engine.py`) accepts a certificate only when the certified commit and the control commit have the same projection; otherwise it answers "qualification inputs differ from selected control". The projection hashes the whole of `server/scripts`, minus pure test files (O4) and a short list of offline families (O9, 2026-11-22).

`server/scripts` is also where the Horse lane keeps research leagues, fits, probes and solver workers. On 2026-11-26 at 07:15 CST the Horse lane merged `ad8d1e8f1` (PR #12085). Inside `server/scripts` it changed two files:

| File                                                       | In The Projection Before This Change                     |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `server/scripts/generate-horse-opener-response-vectors.ts` | No (already covered by the O9 prefix `generate-`)        |
| `server/scripts/oop-reraise-range/league.ts`               | Yes (no O9 rule named the `oop-reraise-range` directory) |

The second file moved the projection. The freshly certified release-control build `13bce958d4c3` became unselectable and the 10:00 CST cycle had nothing to ship. Neither file is read by any release workflow, the engine image, the Backup host scripts or a release script. Twelve hours earlier the same refusal came from a real release-control change, which is the refusal working as designed; this one was not.

## How It Was Fixed

The rule stays an exclusion list, and `server/scripts` stays in `CONTROL_INPUTS`. An allow list of release files was considered and rejected: with an allow list a new release script that nobody remembers to add is silently outside the projection, which is the unsafe direction. With an exclusion list a new or unknown script is hashed by default, and the worst case is the one seen here, a certificate refused once.

Five Horse families and one file were added to `NON_RELEASE_SERVER_SCRIPT_PREFIXES` and `NON_RELEASE_SERVER_SCRIPT_EXACT`:

| Excluded                                              | Files | Every Reader Found In The Repository                                                                                         |
| ----------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/scripts/oop-reraise-range/` (whole directory) | 3     | Each other; comments in `server/src/engine/HorseOopReraiseRangeHolds.ts` and `server/src/benchmark/ExploiterLeague.ts`       |
| `server/scripts/omaha-reraised-pot-priced/` (whole)   | 6     | Comments in `server/src/engine/HorseOmahaReraisedPotPriced.ts`                                                               |
| `server/scripts/feature-ablation-*`                   | 4     | `horse-feature-ablation-preflight.yml`, `horse-feature-ablation-qualification.yml`, path constants in `server/src/benchmark` |
| `server/scripts/gto-v31-*`                            | 2     | `gto-v31-qualification.yml`, `scripts/ci/gto-v31-qualification.mjs`, `scripts/ci/v31-decision-closure.mjs`, one npm alias    |
| `server/scripts/assemble-public215-*`                 | 2     | `public215-linux-preflight.yml`                                                                                              |
| `server/scripts/prepare-public215-feature-request.py` | 1     | `public215-linux-preflight.yml`, `scripts/ci/public215-linux-preflight.mjs`                                                  |

None of the eighteen is named by `stage-engine-release.yml`, `auto-deploy-hetzner.yml`, `backup-engine.yml`, `engine-release-prequalification.yml`, `server/Dockerfile` (which copies named scripts only, never the directory), `server/standby/**`, the `build`, `pretest` or `test` scripts of `server/package.json`, or any script those reach. The engine image is built from `server/src` and the scripts the Dockerfile names; these files are not in it. A Horse script that the qualification's own tests import is still bound to the certificate, because the certificate pins the candidate's whole `server` tree.

The two directories are excluded whole so a new file beside `league.ts` does not repeat the incident.

What stays hashed, on purpose:

- The 49 scripts the release route reaches (pinned by name in the law), including `legacy-census-scale-*` and `native/legacy-census.cc`, which look like research and are copied into the engine image and run by `prewarm-engine-image.sh`.
- `finite-evaluation-worker*.mjs` and `fix-vitest-esbuild.mjs`, run by `pretest` in the qualification.
- Every family the O9 law names as must-keep (`phase*`, `qualify-*`, `privateRecordGateway*`, `reconcile-*`, `main-inspector-*`), and `write-closure-freeze.mjs`, `closure-freeze-files.mjs`, `runtime-settings-publish.ts`, `switch-list-fresh-at-merge.ts`. Several of these have no release reader today. They were left in because nothing proves them out; a later change can remove one with the same evidence.
- `server/src/maintenance`, whole.

## What Happens To Existing Certificates At Merge

`scripts/ci/read-engine-prequalification.py` is itself a `CONTROL_INPUTS` file. The selector runs one copy of the reader for both sides of the comparison, so the rule is never mixed, but the reader's own blob is part of what is compared. Any commit below this merge has the old blob and any control at or above it has the new one, so every certificate earned before the merge is unselectable once, exactly as for any other release-control change. This cannot be made backward compatible without taking the reader out of its own projection, which would let a change to the rule go unnoticed; that was not done.

So this merges only in the post-seal slot, and the next cycle ships a build certified at or above the merge commit. After that, an edit to any excluded Horse family no longer costs a certificate.

`scripts/ci/backup-freeze-baseline.py` reads the same two constants by name from main, so its "would this baseline be selectable" answer follows the new rule with no change of its own.

## What Stops It Returning

`tests/the-release-projection-names-only-release-files.law.test.ts`:

1. Walks from the release surfaces through every helper and script they name and fails if any `server/scripts` file it reaches is excluded. A release script cannot be moved outside the projection, and a new exclusion that catches a release file fails with the name of the surface that reads it.
2. Builds a real git repository and proves that a commit touching only `generate-horse-opener-response-vectors.ts` and `oop-reraise-range/league.ts` leaves `projection()` equal, that a script no rule names changes it, and that `engine-release-transaction.sh` changes it.
3. Pins the exclusion lists and the 49 reached release scripts, so widening or narrowing either is a visible diff.

The O9 law (`tests/non-release-server-scripts-are-unreferenced-by-release-surfaces.law.test.ts`) is unchanged and still passes with the longer lists.

## Verification

- New law: 3 of 3 pass. Mutation check: adding `server/scripts/legacy-census-` to the exclusions makes part 1 fail and name `prewarm-engine-image.sh` as the reader.
- `python3 -B tests/operations/engine-prequalification.test.py`: 23 pass.
- The other suites that read the reader or the selector are listed with their results in the pull request.
- On current main the projection drops from 114 to 96 paths across `server/scripts` and `server/src/maintenance`.

## Live Proof

Pending. The proof is the first cycle after the merge selecting a build certified at or above the merge commit, and then a Horse-only merge inside an excluded family leaving that certificate selectable.
