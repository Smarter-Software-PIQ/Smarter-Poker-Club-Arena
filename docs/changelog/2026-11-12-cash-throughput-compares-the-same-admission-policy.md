# Cash throughput compares the same admission policy

Incident 71fdf977 recurred after the Lightning-only counter correction. At
10:50 UTC on November 12, the current 30-minute window committed 847 Lightning
hands against 3,234 / 2,569 / 2,351 on preceding days. The installed November 12
admission definition restored the owner's 70–90-second arrival pace everywhere;
the earlier accelerated population is not a comparable capacity baseline.
Adding Classic cash hands (195 against 168 / 151 / 141) would not correct that
comparison. This change preserves the approved pace and does not modify money,
seating, admission floors or release controls.

The existing same-hour comparison now accepts only complete 30-minute windows
with the same installed admission-function fingerprint. It still requires at
least three days, compares the previous six, uses the existing 0.5 ratio and
0.5 hands/second baseline floor, and retains maintenance and owner-park guards.
A missing, failed, duplicated or stale policy observation is explicitly unknown.
A readable policy without three comparable days produces a warming warning;
zero-dealing and table-stall rules remain independent.

## Publication prerequisite

Do not publish this consumer until producer PR #10589 is merged, its migration
is installed, and the maintained monitoring-health collector installation emits
`poker_lightning_admission_policy_fingerprint` and
`poker_lightning_admission_policy_collect_ok` with fresh collection time.
The collector's installation belongs to the existing certified engine-control
route. Merging the database function alone does not install that collector.
The first policy recording series has no historical days: warming is expected
until three complete same-hour days exist. Do not synthesize past samples.

This consumer remains separate from the pending Classic-counter work in #10516
and #10534. Their producer prerequisite remains in force; integration must retain
this same-policy eligibility rather than restore a mixed-admission baseline.

## Retained verification

The maintained promtool fixture covers changed admission policies, a real drop
under the same policy, warming, absent/failed/stale telemetry, a definition change
inside the measurement window, and recovery after an unreadable interval.
Existing short-history, tiny-baseline, maintenance, park, recovery and tournament
exclusion cases remain. The existing CI fixture and routing script executes this
file and verifies that unknown telemetry reaches the critical inbox/email route
and warming reaches the warning inbox route.

## Live acceptance

Use Deploy Monitoring after the producer prerequisite, verify the loaded rules
through `/api/v1/rules`, inspect the readable/stable policy and warming state,
then observe the existing incident's natural recovery and quiet interval.
Source tests and a merged PR do not establish live acceptance.
