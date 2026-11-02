# Platform Staff Check Fails Closed (2026-11-02, #9390)

- `fn_is_platform_admin()` answered NULL for a signed-in caller with no profile row (or a NULL role). Sixty-two staff functions gate with `NOT fn_is_platform_admin()`, and `NOT NULL` let that caller in.
- Migration `20261102192037` returns `COALESCE(role IN ('admin','superadmin','god'), false)`: same signature, security and grants. Positive checks are unchanged; every `NOT` gate now refuses.
- Native PG17 regression `scripts/ci/test-platform-admin-check.sh` reproduces the defect on the old body, then proves no caller, no profile, NULL role and ordinary users are refused and staff are still served.
- Rabbit hunt kept run-outs: added coverage that a corrected charge keeps the purchase, a retried receipt keeps one row, a dealt-in player who did not buy reads nothing, and signed-out callers cannot ask.
