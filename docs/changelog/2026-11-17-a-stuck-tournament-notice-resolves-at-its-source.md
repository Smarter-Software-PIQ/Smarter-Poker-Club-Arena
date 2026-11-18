# A stuck tournament notice resolves at its source

**2026-11-17. Migration `20261117173255`.**

## What was wrong

The Smarter.Poker stuck-tournament condition is reported by two notices, both keyed by tournament id:

- `CriticalPage.stuck_tournament` (`sp-critical-pager`), written by `fn_sp_critical_scan()` every 5 minutes.
- `DailyDigest.stuck_tournament` (`sp-daily-digest`), written once a day by the digest attention rule.

Neither ever wrote `resolved`. The Reliability Controller closes an incident only through a resolved signal from the member that fired. So incidents `5d8a2c02` and `24c9bbaf` stayed escalated after Nightly 20K `10d3c9b3` completed and paid at 17:05:27Z. 151 pager rows and 78 digest rows were still firing for tournaments that had stopped RUNNING long ago.

## The fix

The fix is in the producer. On every pass, `fn_sp_critical_scan()` now moves each firing stuck_tournament notice of either sp source to `resolved` in place, when its tournament is no longer RUNNING or no longer exists. It writes `resolved_at`, `resolution` and `resolved_by` into the payload. This is the same in-place shape `fn_ca_engine_cutover_watch` uses. The existing intake trigger on a status change carries the update to the controller, which closes the incident through `resolved_signal`.

## Why the 5-minute scan also closes the digest's notice

The digest is a once-a-day report of the same predicate, using the same `stuck_tournament_hours` setting.

- **Resolving on the next digest:** a cleared condition would stay open for up to a day.
- **Linking sources in the controller:** one source's resolution would close another's incident, which moves producer semantics into the controller.

The scan already owns the predicate, so it states when the condition ends for both of its notices. There is no new schedule, watcher or reconciler. The bounded statement measured 8 ms on production over all 229 open rows.

## Unchanged

- A notice whose tournament still runs stays firing.
- A notice with a malformed tournament id stays firing.
- Other pager rules are unchanged. They are point-in-time findings, not conditions.

## Regression protection

- `scripts/ci/test-stuck-tournament-notices-resolve.py` (native PostgreSQL 17, workflow `a-stuck-tournament-notice-resolves-at-its-source.yml`). It shows the defect on the exact captured preimage and proves the fix.
- `tests/a-stuck-tournament-notice-resolves-at-its-source.law.test.ts`. It refuses a later rewrite of the function that drops the step.
