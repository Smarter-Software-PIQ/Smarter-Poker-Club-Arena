# Engine Cutover Merge Rules

The engine cuts over every three hours, at 01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00 and 22:00 America/Chicago (S below). A cycle ships only when a candidate was certified on the Backup host against a current copy of production, before the selection at S-30. These rules keep that possible every cycle. Times are Chicago wall clock.

## The Rules

1. **Migrations merge only in [S+10, S+30).** An ordinary migration merged at any other time sits uninstalled on main until the next window (up to 150 minutes). The Backup cannot certify any commit that carries it, so every engine commit merged after it waits a full cycle. For the 04:00 anchor the window is 04:15-04:30 (the nightly freeze holds every install until 04:15).
2. **Release-control changes merge only in [S+10, S+30).** A release-control change is any non-test path in `CONTROL_INPUTS` (`scripts/ci/read-engine-prequalification.py`): the release workflows, the selector, the prequalification reader, the seal and maintenance code. Prequalification compares the candidate's control inputs with main's. After a control change, every older certified candidate is unselectable for good, and only a new certification can make the cycle ship. Merged in the window, the change's own Backup run certifies it before the next selection.
3. **Nothing of either kind merges after the candidate push.** The cycle's candidate is the last push that can still be certified before S-30 (a certification takes about 60 to 70 minutes). A migration or control change merged after it orphans that candidate. Merge it in the next window instead.
4. **Merge at once after a green check.** The check below is evaluated when its event fires, not at merge time. A green answer holds for the minutes it names. If you missed them, re-run the check and wait for the next window.
5. **Documentation is never a release control.** Markdown files are left out of the control-input set, and a docs-only change merges at any time.

## How Each Rule Is Enforced

| Rule | Enforcement                                                                                                                                                                                                   | Where                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1, 3 | Pull-request check "An ordinary migration merges only in its install window": red outside [S+10, S+25), names the next window                                                                                 | `.github/workflows/an-ordinary-migration-merges-only-in-its-install-window.yml`, `scripts/ci/migration-merge-window.mjs` |
| 1    | The dispatcher installs ordinary migrations only in [S+10, S+30) (150-minute hold before each cycle)                                                                                                          | `scripts/ci/merged-migration-dispatch.mjs` `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES`                                       |
| 1    | If a migration still merges outside the window, the Backup certifies the newest commit that carries no uninstalled migration instead of deferring. The window's last install starts one certification of main | `.github/workflows/backup-engine.yml` refresh `due` step and `workflow_run` on Apply Merged Migration                    |
| 2, 3 | The same pull-request check: a change to a non-test `CONTROL_INPUTS` path is red outside [S+10, S+25)                                                                                                         | same workflow, `--control`                                                                                               |
| 5    | `DOCUMENTATION_FILE_SUFFIXES` drops Markdown from the projection                                                                                                                                              | `scripts/ci/read-engine-prequalification.py`                                                                             |
| All  | The cutover log names every refused candidate with its reason, and the readiness post names the commit an active Backup run is really certifying                                                              | `scripts/ci/select-daily-engine.py`, `scripts/release/three-hourly-readiness.py`                                         |

## What Is Not Enforced Yet

- The check is not yet a required check on main, and main has no merge queue. Until both are set (ruleset 21163380), the rules bind whoever merges, and the check only tells them.
- A green answer obtained inside the window but used after it is not caught without a merge queue. With a merge queue, the check's `merge_group` run is evaluated at merge time.

## Why (2026-11-25 and 2026-11-26)

- 13:00 to 22:00 on 2026-11-25: migrations merged outside the window made every later commit uncertifiable until the next window.
- 01:00 on 2026-11-26: `c951436a6ead` was certified at 06:14:51Z, but release-control PR #12038 (backup-engine.yml, stage-engine-release.yml) had merged after it at 04:51Z. The selector refused it ("prequalification unavailable (qualification inputs differ from selected control)"). The next commit, `6f062e8f0d1d`, carried a migration merged outside the window and could not be certified. The cycle kept serving.

See also `docs/ops/engine-cutover-timetable.md` (every window by slot) and `docs/ENGINE-RELEASE-RUNBOOK.md`.
