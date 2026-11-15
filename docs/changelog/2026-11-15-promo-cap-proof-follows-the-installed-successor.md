# The promo cap proof follows the installed successor (2026-11-15)

## What failed

`scripts/ci/test-promo-downline-limit-postgres.py` (Accounting shard) failed on main at "live browser contract pins the qualified cap body", first seen on #10911's hosted run 43670164259.

## Cause

My change #10888 re-pinned the live contract's promo core body from `7087a67e…` (what migration 20261112050118 produces) to `be708b91…` (what production holds since World Hub 20261114174204 patched it in place). That is the correct live pin, but this proof still required the contract to pin the 050118 body unchanged. #10888's own checks did not run this shard, so the break reached main. The mistake is mine.

## Change

The proof still requires this migration to yield exactly `7087a67e…`. It then applies the one recorded World Hub patch (byte-checked fixture, anchor required exactly once) and requires the contract to pin that result and to name `20261114174204`. The superseded body alone must no longer be pinned. No financial check is removed; every send, cap and concurrency case below it is unchanged.

## Limits

The cases in this file still exercise the 050118 body, not the World Hub 24-hour ceiling added on top of it.
