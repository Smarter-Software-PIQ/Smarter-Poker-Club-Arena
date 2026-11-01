# Isolate heavy action-row geometry cases on each browser runner

PR 9023's required CSS general shard 7 failed one embedded action-row case and
reported three flaky cases. The failing retry exhausted its 60-second case
budget after eight cold scenes; all eight mocked VPIP responses succeeded and
all eight indicators rendered in its trace. Other initial attempts exceeded
the unchanged five-second indicator wait. This is not proof of a product layout
or VPIP defect. The same four cases passed locally with four workers.

The global fully-parallel configuration made these expensive cases compete on
the same runner. Put only this group in default execution mode, so its cases
run consecutively and independently. Unlike serial mode, a failure does not
skip later cases. Keep every viewport, inset, ticker, swipe mode, four hand
states, cold navigation, real component, geometry assertion, five-second wait,
60-second case limit and existing retry policy. Other browser groups keep
their existing concurrency. No product source or production action changed.

Local qualification: all 12 cases (96 cold scenes) passed once with no skips
or retries in 116.442 seconds; every case used worker 0 despite the unchanged
four-worker launch. Root TypeScript completed with exit 0. Still require
the exact submitted candidate's hosted CSS gate. A local pass does not certify
the reported live action issue or the live keep-game-pages journeys.
