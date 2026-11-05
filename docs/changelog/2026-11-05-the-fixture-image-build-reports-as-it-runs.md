# The Fixture Image Build Reports As It Runs

The native fixture check builds its reviewed Docker image inside `operations/release/ci/fixture-smoke.py`. The wrapper held all build output until the build returned, so when a hosted runner was lost mid-build (2026-11-04: "The runner has received a shutdown signal" five to ten minutes into the build, and one attempt that hung past its own 40 minute build limit) the job log showed nothing after the command started.

The reviewed image build, and only that command, now forwards each output line to the job log as it runs, prefixed `[fixture-image-build]`. The bounded `native-build.log` artifact is still written, now also on a timeout. Native service output stays private exactly as before. No test, time limit or fixture input changes.
