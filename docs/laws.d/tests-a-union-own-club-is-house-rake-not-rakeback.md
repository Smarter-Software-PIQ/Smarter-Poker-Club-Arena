# tests/a-union-own-club-is-house-rake-not-rakeback.law.test.ts

Rake earned at a union's own club (`clubs.is_union`) is house rake that round 1 retains in full, never player rakeback: `fn_rakeback_recompute_periods` and `fn_rakeback_recompute_split` raise `rakeback_for_union_own_club_refused`, `fn_accounting_split_advance_due` never resumes parts for such a club, the paying calculator/split_check/split_write are untouched, and the six periods written in error on 2026-11-02 (54.95 on 78.50 of rake, equal to round 1's `house_rake`) are retired `closed`, not paid.
