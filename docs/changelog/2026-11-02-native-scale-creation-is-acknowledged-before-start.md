# Native scale qualification records creation before execution

The FCCC preparation receiver 41404861113 refused after the combined Docker run client timed out and its cleanup inspect timed out. Its retained synthetic output passed, but the controller had no acknowledged creation identity. That output does not qualify the failed receipt.

## Source correction

`server/scripts/legacy-census-scale-preflight.py` previously combined creation and execution in `measure` (around line 350). It now creates the isolated container first, validates its immutable ID, and fsyncs an exclusive mode-0600 acknowledgement bound to image, attempt, name and qualification key before attaching and starting it. Creation and attachment share the original 35-second client budget; the fixture deadline, 40-second total/cleanup budget, resources, output bounds and two-measurement ceiling remain unchanged.

Cleanup and interrupted-operation recovery use that ID plus the exact image and label. An ID absence fallback queries the daemon by ID, avoiding a misleading name-filter result. A known creation that subsequently times out can retain the existing single fresh-measurement eligibility, but only after cleanup is proved. Unknown creation, fit failures, signals, identity drift and exhausted attempts remain refused. No prior receipt is rewritten or reclassified and no production engine or financial state is repaired manually.

## Regression protection

The lost-acknowledgement regression failed against the original controller and passed after the correction. The focused controller suite covers durable creation before start, unknown/malformed creation, persistence failure, shared time budgets, immutable identity/image/label mismatch, ID absence filtering, dual-channel output bounds, signals, crash recovery and the one-fresh-measurement ceiling. Existing Engine Build Resource Containment invokes this suite for the changed paths.

Files were reread after editing. Local and hosted results, protected revision, provider installation and live registration evidence belong in the owning task checkpoint; source tests alone do not establish release or automatic Horse registration.
