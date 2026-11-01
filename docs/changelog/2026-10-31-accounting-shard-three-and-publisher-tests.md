# Balance accounting qualification and overlap isolated publication tests

Normal CI run 41241652445 measured accounting shards at 1380, 814, 1994,
1214, 757, 710 and 764 seconds. Three independent suites move intact from
shard 3: backed payout discovery to 2, the Lightning phase 6 matcher to 7,
and base phase 12 chaos to 6. The separate phase 13 chaos chain stays on 3.
Every command, assertion, artifact, deadline and required aggregate remains.
The seven existing standard runners are unchanged.

Publisher 41244415428 spent 127.967 seconds in the crash-drill law fixture.
Its eight independent stub-host cases now execute two at a time, each with
its own temporary host, process, environment, locks and unittest result.
The caller verifies the exact eight-case inventory and zero failures,
errors or skips. All scenario assertions and real recovery deadlines remain.
No production engine script changes or engine activation are involved.

The publisher's additional 43-second origin wait was valid serialization
behind publication 41244315990. Production locking remains intact. These
source changes do not promise a fixed delivery time; normal final-candidate
CI and publication supply the measured result. Repositories stay public and
paid-runner selection is not introduced.

Integrated qualification exposed a historical fixture clock dependency at
23:00 UTC on October 31: its October 24 hand fell outside a rolling seven-day
window while the captured daily cron total still included that date. The
private initdb fixture now anchors only that historical cutover to October 25
and restores PostgreSQL's native clock before calendar/downline checks.
The connection, role and owned data-directory guards prevent applying the
clock anchor to a connected database. Production migrations and every
financial assertion remain unchanged. Focused PostgreSQL 17 qualification
passed, including the subsequent real-clock calendar and downline scenarios.

Normal CI then exposed an upstream runner-image change: ubuntu-latest
resolved to Ubuntu 26.04, which locked Playwright 1.58 refused before browser
checks could execute. Browser-dependent CI and post-publication jobs now pin
the previously working standard Ubuntu 24.04 image; the accounting job uses
the same stable image for PostgreSQL 17 prerequisites. No paid runner, test
skip, deadline reduction or alternative publisher is introduced.
