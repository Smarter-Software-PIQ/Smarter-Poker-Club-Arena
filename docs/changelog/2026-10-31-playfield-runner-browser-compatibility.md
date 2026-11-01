# Preserve the supported hosted image for Chromium qualification

All three required Diamond playfield shards in run41257103889 failed during
Chromium installation on the newly selected Ubuntu26.04 hosted image. The same
locked browser and commands passed on Ubuntu24.04 in run41255280512.

Only that matrix job now selects ubuntu-24.04. Its three shards, software WebGL,
cases, deadlines, retries, evidence and aggregate gate remain intact. The existing
runner contract asserts the exact supported image before normalizing that one
field; the whole-job fingerprint continues protecting every original command.
The Production Build job subsequently failed at its performance-browser install
on the same unsupported image. Its prior Ubuntu24.04 run installed Chromium and
passed route budgets. That job receives the same runner-only correction.
Three CSS browser shards then failed at the same installer before tests;
their matrix job also selects the supported image, preserving all twenty shards.

Current CI source bindings record these exact runner changes separately from
historical financial evidence. No browser upgrade, alternative provider or
gameplay change is introduced.

The parallel-delivery contract also asserts the exact supported image for these
three named CI jobs; every other CI and publication job retains its prior runner
expectation and the prohibition on custom or self-hosted runners.
The dependency-free Node caller contract applies the same exact job-bound routes.
