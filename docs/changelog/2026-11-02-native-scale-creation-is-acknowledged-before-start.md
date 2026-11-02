# Native scale qualification records creation before execution

The FCCC preparation receiver 41404861113 refused after the combined Docker run client timed out and its cleanup inspect timed out. Its retained synthetic output passed, but the controller had no acknowledged creation identity. That output does not qualify the failed receipt.

## Source correction

`server/scripts/legacy-census-scale-preflight.py` previously combined creation and execution in `measure` (around line 350). It now creates the isolated container first, validates its immutable ID, and fsyncs an exclusive mode-0600 acknowledgement bound to image, attempt, name and qualification key before attaching and starting it. Creation and attachment share the original 35-second client budget; the fixture deadline, 40-second total/cleanup budget, resources, output bounds and two-measurement ceiling remain unchanged.

Cleanup and interrupted-operation recovery use that ID plus the exact image and label. An ID absence fallback queries the daemon by ID, avoiding a misleading name-filter result. A known creation that subsequently times out can retain the existing single fresh-measurement eligibility, but only after cleanup is proved. Unknown creation, fit failures, signals, identity drift and exhausted attempts remain refused. No prior receipt is rewritten or reclassified and no production engine or financial state is repaired manually.

## Regression protection

The lost-acknowledgement regression failed against the original controller and passed after the correction. The focused controller suite covers durable creation before start, unknown/malformed creation, persistence failure, shared time budgets, immutable identity/image/label mismatch, ID absence filtering, dual-channel output bounds, signals, crash recovery and the one-fresh-measurement ceiling. Existing Engine Build Resource Containment invokes this suite for the changed paths.

Files were reread after editing. Local and hosted results, protected revision, provider installation and live registration evidence belong in the owning task checkpoint; source tests alone do not establish release or automatic Horse registration.

## Required accounting qualification dependency

Required CI reproduced the existing same-week incident fixture crossing the Los Angeles accounting-week boundary during Monday’s first ten minutes. Incorporated the exact three fixture/derived-pin files from published source commit `319740d930f7f6300647071b9236b7085200f391` without editing the production guard or original fixtures. Both incident and reporting drivers clamp their synthetic incident timestamp to the accounting-week start; native boundary assertions cover midnight, ten minutes and both DST offsets. This is a source correction to the demonstrated qualification blocker, with no production SQL or financial mutation.

The required inventory concurrency qualification also reproduced a UTC seven-day subtraction selecting the wrong Los Angeles lock boundary across DST. Protected main `7c1dc2204570769e0c6edbc857d43907275f2146` already contains the canonical correction and stronger previous-boundary validation across UTC, Chicago and Tokyo; forward integration retains those exact fixture and pin bytes. The original UTC native fixture fails before correction and the integrated fixture passes afterward, retaining the real wait/committed-data assertion and negative stale-snapshot control. Production accounting SQL and historical certificates remain unchanged.
