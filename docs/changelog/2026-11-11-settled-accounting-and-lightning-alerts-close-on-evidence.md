# Settled accounting and Lightning alerts close on evidence

Nineteen critical `financial_alerts` rows from 2026-10-26 to 2026-11-02 stood
open after their conditions had ended, because nothing that owns them could
close them:

- `weekly_club_accounting` "Weekly club accounting is incomplete": the
  club-scope success path of `fn_process_weekly_accounting_scope` never closes
  its own alert (the union path has since 2026-10-17). That function is
  md5-pinned by the payout eligibility reader, so the close sits beside the
  resolver's nine evidence classes instead.
- `union_accounting_scheduler` "A weekly inventory seal step did not fit the
  bounded close tick" names no scope, so no receipt was ever matched to it.
- `lightning_alerts` `reaper_failure` is a state page that the sweep never
  re-measures. While it is open, `fn_lightning_alert_raise` answers `open` for
  that Cluster, so the reaper monitor is blind there.
- Their `drift_incident:financial_alerts:*` echoes, whose incidents were
  retired as `aged_out_unverified`, stay open forever.

`20261111224606` adds `smarter_private.financial_alerts_proven_over`, called
once per run by `fn_resolve_settled_financial_alerts`. It closes a row only on
a completion receipt in `union_accounting_runs` (same club and week, success,
after the alert; for the unscoped seal step, every union week ending in the
four weeks before the alert complete and the one just ended completed after
it), or on a re-measurement (Lightning Cluster not frozen, no live instance past
its deadline beyond its alert window, no failed reap in that window, page at
least 15 minutes old). An echo closes only when its parent closed on evidence,
never when the parent only aged out. Each resolution cites its evidence. No new
schedule, and nothing but alert rows changes. Integrity-sweep review signals
are not touched.

Native PostgreSQL 17 (`scripts/ci/test-financial-alerts-proven-over-postgres.py`,
in the required weekly accounting activation step): three conditions and
three echoes close with evidence-citing resolutions; thirteen refusing twins
(week finished before the alert, failed week, malformed period, unfinished
recent union week, instance past deadline, failed reap in window, frozen
Cluster, page younger than 15 minutes, echo of an open parent, of an aged-out
parent, of another source) and two unrelated alerts stay open; a dry run writes
nothing; a second apply closes nothing; the whole migration installs over the
md5-pinned production resolver, grants no browser role and refuses a replay.
