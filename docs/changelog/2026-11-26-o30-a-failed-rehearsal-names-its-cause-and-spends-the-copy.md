# O30: A Failed Rehearsal Names Its Cause And Spends The Copy

Date: 2026-11-26 (Chicago). Lane: release custody (engine cutover every three hours).

## Why It Broke

After the 07:00 CST seal three Backup certifications in a row were refused with the same reason, `rollback_rehearsal_failed_to_132ef19f0770`:

| Run           | Commit         | Rehearsal Window (CST) | What The Timing Shows                                                                                                                                            |
| ------------- | -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `45827343954` | `9b35df50813b` | 07:57 to 08:48         | The candidate dealt, the rollback to the serving build ran at 08:01, then 47 minutes passed: the 30-minute thaw wait and the 20-minute dealing wait both ran out |
| `45827378798` | `9b35df50813b` | 08:50 to 09:11         | Exactly 1200 s before any swap: the copy was never in open play                                                                                                  |
| `45845308550` | `2b7b5fccb7eb` | 09:12 to 09:33         | Exactly 1200 s again                                                                                                                                             |

Two defects in the certification itself made this worse than one refusal:

1. `cmd_certify` called `certified_player_swap ... >/dev/null`. The trial's verdict line, which lists the failed steps, was discarded, so the certificate and the log said only "rollback rehearsal failed".
2. The first failure left the copy inside that trial's break. The next runs found the copy "current" by its migration set, did not restore it, and waited 1200 s each for play that could not start. They were refused for the previous run's leftover state.

## How It Was Fixed

`server/standby/standby-engine.sh`:

- The swap's output is kept in a file (not `$(...)`, because the swap sets `SWAP_ADOPTION_SECONDS` in the calling shell). On a failed rollback or forward rehearsal, `rehearsal_failure_detail` reduces the last swap verdict to its cause and timings. It is logged and written into the certificate as `rehearsalFailure`. A trial that ended before writing a verdict reads `no_verdict`.
- `mark_copy_spent` then sets `restoreValidated` to false in the copy's `database.json` and records `spentBy`. The workflow's copy stamp reads such a copy as never restored, so the next run restores it; `assert_valid_copy` refuses any run that tries to reuse it. A restore writes the file afresh.
- The refusal tokens are unchanged.

## What Stops It Returning

`tests/a-failed-rehearsal-names-its-cause-and-spends-the-copy.law.test.ts`, and the rehearsal cases in `tests/dr-posture.test.ts` (which also caught a first draft that lost the adoption time in a subshell).

## Verification

- The new law: 8 of 8. `dr-posture`: 119 of 120; the one failure needs the `ws` package, absent in the cloud clone.
- Not run here: `cmd_certify` on the Backup host.

## Still Unknown

Why the rollback at 08:01 CST never thawed. The next failed rehearsal after this merge will name the step.
