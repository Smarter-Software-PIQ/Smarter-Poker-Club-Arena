# tests/the-three-hourly-readiness-cli-only-reads.law.test.ts

`scripts/release/three-hourly-readiness.py` is strictly read-only (explicit HTTP and `gh api --method GET`, zero writes, dispatches, git mutations or `.env` reads), computes `CONTROL_INPUTS` equality through `scripts/ci/read-engine-prequalification.py`, fails closed to `UNKNOWN` (exit `3`) on any unreadable source, passes `tests/operations/three-hourly-readiness.test.py`, and is documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`.
