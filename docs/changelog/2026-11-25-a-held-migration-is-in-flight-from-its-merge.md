# A Held Migration Is In Flight From Its Merge, Not From Its Stamp

## What Broke

`Installed and merged migrations agree` (`migration-ledger-reconciled.yml`, step
"Every merged migration is installed within 24h or marked superseded") failed every pull
request on 2026-11-25 from 20:56 to 22:10 Chicago. The file it named,
`20261124171043_the_hand_gap_grade_names_its_worst_hands.sql`, was exactly where it
should be: merged at 02:56Z and held by the dispatcher's 150-minute pre-cutover
deferral (O21) until 04:10Z.

`check-migrations-are-live.mjs --min-age-hours 24` read a file's age from its version
stamp alone. The pull request had sat for a day, so the stamp was a day old and the file
read as overdue the moment it merged. With the deferral now holding ordinary files up to
160 minutes in daytime and 345 minutes across the nightly freeze, any migration whose pull
request waited a day turned every other branch red for hours.

## The Fix

The grace now counts from the later of the version stamp and the commit that added the
file to main (`git log --diff-filter=A`, the squash merge). The pull-request job checks
out 500 first-parent commits of main (trees only) so git can answer; when it cannot
(shallow past the merge, no git), the stamp alone decides, exactly as before. The
scheduled audit passes no `--min-age-hours` and is unchanged.

## Hardening

`tests/a-merged-migration-must-be-live.law.test.ts`: the later of stamp and merge, a
re-stamped file never shortened below its stamp, every unreadable history falling back
to the stamp, the exact bounded git question, and the checkout depth in the workflow.
