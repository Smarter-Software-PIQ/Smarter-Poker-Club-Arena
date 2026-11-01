# Preserve the supported hosted image for Chromium qualification

All three required Diamond playfield shards in run41257103889 failed during
Chromium installation on the newly selected Ubuntu26.04 hosted image. The same
locked browser and commands passed on Ubuntu24.04 in run41255280512.

Only that matrix job now selects ubuntu-24.04. Its three shards, software WebGL,
cases, deadlines, retries, evidence and aggregate gate remain intact. The existing
runner contract asserts the exact supported image before normalizing that one
field; the whole-job fingerprint continues protecting every original command.
No browser upgrade, alternative provider or gameplay change is introduced.
