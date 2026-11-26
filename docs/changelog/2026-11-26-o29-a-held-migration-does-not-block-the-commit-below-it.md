# O29: A Held Migration Does Not Block The Commit Below It

## Why It Broke

The 01:00 CST cycle of November 26, 2026 kept serving `d07cd7d7feec`, and the 04:00 CST cycle shipped only because a certification was dispatched by hand.

Protected main, oldest to newest, late on November 25 (Chicago time, UTC in brackets):

| Commit         | Merged                | What It Is                                                                                 |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `c951436a6ead` | 22:48 CST (04:48 UTC) | The newest commit touching `server/`.                                                      |
| `a5e971803865` | 22:50 CST (04:50 UTC) | A release-control change (`stage-engine-release.yml`, `backup-engine.yml`).                |
| `6f062e8f0d1d` | 22:54 CST (04:54 UTC) | Another lane's fix. It adds `supabase/migrations/20261126021630_*.sql` and nothing engine. |

1. After `a5e971803865`, `c951436a6ead` could never be selected: the selector requires the candidate's release-control projection to equal the control's.
2. `6f062e8f0d1d` merged inside the migration hold before the 01:00 CST cycle (22:30 to 01:10 CST) and then the nightly release schema freeze (23:45 to 04:15 CST), so the dispatcher would not install its migration until 04:15 CST.
3. Backup run 45757793983 (the push of `a5e971803865`) planned "certifying a5e97180 as pushed", then yielded to the newer push run and ended.
4. Backup run 45758112198 (the push of `6f062e8f0d1d`) waited for the host and answered the O7 rule: `DEFERRED: 6f062e8f... carries uninstalled ordinary migration(s) (20261126021630) still absent from production after wait; certifying on a copy lacking them can never be selected. Host handed back cleanly, no status written.`
5. The freeze-baseline reader answered `unselectable` for `c951436a6ead` and planned as before, which reached the same hand-back.

The O7 answer was right about `6f062e8f0d1d` and silent about everything else. `a5e971803865`, one commit below, carried current release controls, no uninstalled migration and an engine tree ahead of the serving build. Nothing certified it. For more than five hours no commit on main could be certified, and the 00:30 CST selection posted on issue #11599 (2026-11-26 06:30:48 UTC): `KEEP-SERVING ... c951436a6ead: prequalification unavailable (qualification inputs differ from selected control)`.

One held migration from another lane blocked every cutover until it installed.

## How It Was Fixed

The `due` step of `.github/workflows/backup-engine.yml` no longer hands the host back as soon as it sees a held migration. It first asks `scripts/release/step-down-past-held-migration.py`, once, for the newest shippable commit that does not carry it:

1. `first` is the oldest first-parent commit between the serving build and the run's control that added any pending migration file.
2. `base` is `first^`, or the run's own target when that target already sits below `first` (the post-seal shape, where the target is main's newest server or release-control commit and the migration merged above it).
3. `fallback` is the newest first-parent commit at or below `base` that touches `server/` or any `CONTROL_INPUTS` path (the O13 rule).

The fallback is accepted only when each of these was read, not assumed:

- It is strictly ahead of the serving build (the sealed build for a post-seal run, otherwise the running engine's `/health` `releaseSha`).
- Its release-control projection equals the control's, through the same `projection` in `scripts/ci/read-engine-prequalification.py` that the selector compares.
- The same installed-migrations read that named the held files, asked about the fallback's own line, names none.
- The run's control is its own commit. The control is never moved, because `select-daily-engine.py` admits a certificate whose control differs from its producer only for a forward push retarget.

When it is accepted the step prints `STEPPED DOWN: <sha> carries held migration(s) (<list>) not installed until the dispatcher's window; certifying <fallback>, the newest shippable commit below it.`, judges the copy again for the fallback, and writes `sha=<fallback>` as a step output. The refresh job's `sha` output, the late owner-window check and every certify step read that output first, so the pending mark, the policy check, the soak, the certificate artifact and the verdict all name the fallback. No status is written on the original commit.

Which runs ask:

| Run                                                                    | Behaviour                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Push (not forced)                                                      | Steps down, or hands back exactly as before with the reason added.       |
| Post-seal next candidate                                               | Steps down (or certifies its target when the migration merged above it). |
| Backup after keep-serving (O27, no `sha` input)                        | Steps down; with no fallback it certifies main exactly as before.        |
| `workflow_dispatch` with an explicit `sha`                             | Never stepped down: a named commit is certified exactly.                 |
| Freeze baseline, booking commit, forced push, schedule, plain dispatch | Unchanged.                                                               |

## What Stops It Returning

- `tests/a-held-migration-does-not-block-the-commit-below-it.law.test.ts` runs the workflow step's own shell on a disposable git repository with the real script, the real release-control reader and the real installed-migrations reader. It reproduces the November 26 shape and requires the release-control commit to be certified, and it requires the old hand-back for no fallback, a retargeted run and an unreadable serving build.
- `tests/operations/step-down-past-held-migration.test.py` covers the decision on real git: two held migrations step below the older one, a fallback with different release controls or not ahead of serving is refused, an explicit `sha` is exempt, and an unreadable git, reader, production or `/health` exits 3.
- "Could not tell" stays its own answer (CLAUDE.md 10.86): exit 3, or any output without a 40-hex `fallback=`, leaves the run on the O7 hand-back and the line says so.
- No timer, watcher, dispatch or retry was added. The step-down happens inside the run that already holds the host.

## Verification

Run in the lane's worktree on November 26, 2026:

- `python3 -B tests/operations/step-down-past-held-migration.test.py`: 10 tests pass.
- `tests/a-held-migration-does-not-block-the-commit-below-it.law.test.ts`: 9 tests pass.
- The existing laws that read `backup-engine.yml` were run again; results are in the pull request.
- `python3 -m py_compile` on the script and its test, a YAML parse of the workflow, and `bash -n` on the changed step.

Not verified here: the workflow itself cannot run outside GitHub. The expression wiring (the `steps.due.outputs.sha` precedence in the refresh job's outputs and in the late owner-window check, and the certify job reading the refresh job's `sha`) is covered by source pins only. The live `/health` read and the production read through `DATABASE_URL` are exercised with local stand-ins.

Known limits, stated plainly:

- A stepped-down certificate goes stale when the held migration installs, like any certificate does when production's installed set moves. When the hold is short (the 40 minutes around a cycle) the soak may not finish first; the existing mid-soak yield (O1, O16) still frees the host for a newer push run.
- A run that was retargeted to a newer commit is not stepped down and hands back as before.
- A fallback that already holds a success certificate may be certified again unless the existing already-certified checks (O10, O24) match it.

## Live Proof

Pending. It needs this change sealed, then a cycle in which main's head carries a migration the dispatcher is holding: the Backup run for that push should print `STEPPED DOWN` and the cycle's cutover log on issue #11599 should name the commit below as sealed.
