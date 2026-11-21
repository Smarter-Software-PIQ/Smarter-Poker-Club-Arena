# 2026-11-21: the horse exposure hands are planned for their own window

`ca-horse-exposure-watch-hourly` timed out on every run of 2026-11-21.

**Cause.** `smarter_private.fn_ca_horse_exposure_hands` (20261121011654) is `LANGUAGE sql` with `SET search_path`, so it is never inlined and is planned generically. The generic plan scans `idx_hand_history_created` over every hand in 60 days instead of the partial index `idx_hand_history_human_created`.

**Fix.** Migration 20261122094628 keeps the same body and runs it through plpgsql `RETURN QUERY EXECUTE ... USING p_at, p_per`, so every call gets a custom plan for its own window. Measured on production: 20.7 s, where the old helper ran past 120 s. No timeout, threshold or index changes.

**Pins.** `tests/the-horse-exposure-hands-are-planned-for-their-own-window.law.test.ts` pins the fix. The native proof now runs every case against the fixed helper.

Evidence: `docs/production-alerts/evidence/horse-exposure-watch-generic-plan-timeout/`.
