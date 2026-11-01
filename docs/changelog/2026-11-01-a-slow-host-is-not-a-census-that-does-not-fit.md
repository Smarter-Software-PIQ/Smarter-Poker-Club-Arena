# 2026-11-01: a slow host is not a census that does not fit

Receiver run 41272015208 (image `sha256:9d8886114caf...`, 04:30:28 UTC)
refused at the native census scale gate before intake:

    docker run ... timed out after 34.99s; docker rm -f ... timed out after 1.5s

Measured passing runs of the same fixture take 26.6-27.3 s (queries
16.5-17.2 s), and ca8250444e's image passed in 27.3 s ninety seconds later.
Docker was slow at that instant: a buildkit container start took 7.9 s
against the usual 0.6 s. Nothing about the census failed to fit. Three
defects in `server/scripts/legacy-census-scale-preflight.py` turned that slow
instant into a permanent refusal of the image.

## The three causes and what changed

1. **The fixture could never report.** The fixture's own wall-clock deadline
   was `time.time() + 35` and the Docker client was killed at `35 - elapsed`,
   the same instant. The fixture refuses itself one second before its
   deadline, so it had no time left to print why. The client still owns the
   first 35 s (the 40 s measurement budget less the 5 s cleanup reserve), but
   the fixture's deadline is now 2 s inside it (`FIXTURE_S = 33`,
   `PROFILE.fixtureDeadlineMarginMs = 2000`). A slow fixture now refuses
   itself at 32 s and says so before the client is touched. The qualification
   bound itself (`fixtureMs <= 35000`, `queryMs <= 20000`) is unchanged.

2. **Cleanup was capped at 1.5 s per command while the profile reserved 5 s.**
   A killed `docker run` client leaves its container running, and
   `docker rm -f` of a ~6.7 GB container did not finish in 1.5 s. `cleanup()`
   now spends the real remaining reserve on each step, holding back only
   0.5 s per later step, and when the client never acknowledged the exit it
   runs `docker kill` explicitly before `docker rm -f`, then proves absence
   with the same inspect/daemon-listing proof as before. If a removal step
   fails after the container was seen, that observation is still recorded.

3. **One slow run refused the image for ever.** The receipt was bound
   one-shot to the image with no automatic repeat, so a timeout on a loaded
   host was indistinguishable from a census that does not fit. Now an image
   is measured at most twice, ever (`PROFILE.measurementsPerImage = 2`):

   - A measurement is *timed out* only when every refusal it made is wall
     clock: the client budget, one of the fixture's or addon's own deadline
     refusals (exact strings from the identity-checked fixture and addon,
     listed in `DEADLINE_MARKERS`), or the 40 s total. Any fit, identity,
     signal or serving-change refusal makes it a permanent refusal.
   - The second, fresh measurement runs only after the first timed out and
     its container is proved gone. If the in-run cleanup was not proved but
     the container was seen or its exit acknowledged, a fresh 5 s cleanup
     proves it first; a container neither seen nor acknowledged still means
     unknown and refuses for good.
   - It runs under the same admission the first needs (more than 60 s left
     before the receiver's absolute deadline, the serving identity unchanged,
     36 GiB plus 8 GiB of real host headroom) with its own exclusive
     `<key>.attempt-2.intent`, its own output file and its own container
     name (`...-2`). The exclusive intent is what makes it once only: a crash
     during the second measurement leaves that intent behind and the next
     run cleans up and refuses for good.
   - Without that budget the receipt records `freshRemeasurement:
     "available"` and the refusal names itself retryable; the next receiver
     run performs the one fresh measurement. Nothing schedules it.
   - A second timeout, or any fit failure, records `freshRemeasurement:
     "used"` or `"none"` and refuses for good.

The receipt keeps its existing top-level fields, describing the latest
measurement, and adds `attempts` (each measurement's full record, including
its run id) and `freshRemeasurement`. A qualified receipt is reused exactly
as before. The controller's own SHA-256 and the profile are part of the
binding key, so this controller starts a fresh qualification for every image
rather than inheriting the 41272015208 refusal.

This is not a retry loop: there is no schedule, no repeat inside a measurement,
and at most one further measurement per image across all runs.

## Tests

`tests/operations/legacy-census-scale-preflight.test.py` (run by
`engine-build-resource-proof.yml`) now pins: the pinned budgets and the
33/35/40 s timeline; every deadline marker exists in the fixture or addon
source; kill-then-remove with timeouts far above 1.5 s and a recorded
observation when removal fails; a real client timeout producing a timed-out
measurement with proved cleanup; a fixture-reported deadline versus three
fit failures; unknown cleanup never earning a re-measurement; exactly one
fresh measurement in the same run, then reuse; a second timeout and a fit
failure refusing for good; the budget-exhausted path staying retryable for
the next run and measuring once there; a fresh measurement that left no
receipt never repeating; and a later cleanup proof before the fresh
measurement only for a seen container.
