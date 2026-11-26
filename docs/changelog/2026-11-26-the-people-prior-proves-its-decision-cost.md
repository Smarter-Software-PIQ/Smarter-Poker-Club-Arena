# The people-measured bettor prior proves its decision cost (2026-11-26)

## The defect

Main's Server Engine check (shard 4/4) went red at 22:24 UTC when #12116 merged:
`aPricedOptionProvesItsDecisionCost.law.test.ts` reported
`omahaFacingBetPriorIsPeopleMeasured: a priced or default-off option names its relative-cost law (OPTION_COST_LAWS) or a reasoned exemption (OPTION_COST_EXEMPT)`.
Every open pull request that runs that shard failed with it.

## Why it broke

A merge race. #12116 (the option) last ran CI at 21:49 UTC on a merge ref without the cost gate. #12112 (the gate)
merged at 22:10. #12116 then merged at 22:24 on its earlier green checks. The `main` ruleset (21163380) has
`strict_required_status_checks_policy: false` and requires no merge queue (ci.yml handles `merge_group`, but no
merge-group run has ever happened), so nothing re-tested #12116 against the main that held the gate. Neither PR was
wrong alone.

## The fix

The option has a decision cost (a people-prior cell lookup and, with telemetry on, a second verdict that names
`omaha_people_prior_changed`), so it gets a real relative-cost law, not an exemption:
`server/src/engine/anOmahaPeoplePriorIsFast.law.test.ts`, named in `OPTION_COST_LAWS`. It measures only the
committed real heads-up turn and river states where the option actually prices the decision (it fails if fewer than
10 do), option on against off, telemetry off and on. Measured: ratio 0.99 and 1.04 (limit 4). No strategy code
changed; the option stays default OFF.

## What it does not close

The gate itself already refuses a new option without a cost law on any pull request whose checks see the gate.
The race (checks that ran before main gained a newer gate) is closed only by a required merge queue or strict
required checks on ruleset 21163380. That is a ruleset change and is not made here; ci.yml is already ready for it
(see 2026-11-11-merge-queue-required-checks-and-trusted-reporter.md).
