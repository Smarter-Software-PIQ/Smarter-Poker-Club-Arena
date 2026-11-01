# 2026-11-01: the rake-refresh test no longer fails on the first of a month

Publish runs for 778d9d5b8, a27d9d0f0 and 13b9a8a60 stopped at client-tests
shard 13: `club-data-rake-refresh.test.tsx` clicked Day and expected a third
rake read. The panel defaults to Month, and on the first of a month the
month-to-date range is today, so Day asks the same question and correctly
reads nothing new. The same test passed at 04:45 UTC on ac55bc160 and failed
from 05:00 UTC (midnight Chicago, November 1) on the same code.

The test now changes to Yesterday, which never equals month-to-date. Product
behaviour is unchanged.
