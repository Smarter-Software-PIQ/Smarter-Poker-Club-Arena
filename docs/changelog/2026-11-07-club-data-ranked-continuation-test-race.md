# Club Data ranked-continuation test race (2026-11-07)

`tests/components/club-data-page-renders.test.tsx` "serves the first
metric-sorted continuation from the initial ranked query" failed three
publishes in 30 minutes (runs 42334976144, 42335895370, 42337309644) on line
2778: expected 2 `ca_club_game_page` calls, got 3. It passed locally every time.

Cause, measured with a probe: before the operator picks Highest Fee, the
Recent first paint requests its 100-row continuation twice (the warm-up, and
the auto-loader, because this fixture's first page is short). The test's mock
answered every `ca_club_game_page` call through the ranked branch, whose
`expect(p_limit).toBe(200)` threw for those 100-row Recent requests.
`coldRead` retried them 350 ms later, and on a loaded runner a retry landed
between the two counts.

Fix (test only, no product change): the mock answers Recent requests as Recent
pages, and the assertion counts ranked (`p_sort: 'fee'`) requests, which is
what the test is about: the second hundred came from the first ranked read.
