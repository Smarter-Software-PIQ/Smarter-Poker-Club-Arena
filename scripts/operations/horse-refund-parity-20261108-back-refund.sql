-- ══════════════════════════════════════════════════════════════════════════
--  BACK-REFUND: HORSES ARE REFUNDED EXACTLY AS HUMANS (Dan, 2026-11-08)
--  FOR THE COORDINATOR, AFTER 20261108215333 IS INSTALLED. NOT RUN BY ITS AUTHOR.
-- ══════════════════════════════════════════════════════════════════════════
--
-- What it pays: the 2,220 paid wallet charges (1,827 horse entries, 856
-- horses, 114 events) that the Nov 2 owner retirement swept to Midway Main
-- Bank instead of refunding: 17,931.00 chips. Lists:
-- docs/evidence/2026-11-08-horse-refund-parity/owed-*.csv
--
-- How: smarter_private.horse_refund_parity_back_refund(n) refunds up to n
-- (1..10) charges per call, each in the caller's transaction: Midway Main
-- Bank -> the exact club wallet that was charged, one CLAUDE.md 10.9
-- adjustment citing the ruling, one union_bank journal leg, one wallet
-- receipt, one immutable receipt keyed by the entitlement. 0 previews.
-- Re-running is safe: a paid entitlement is never paid again, and the
-- pinned set refuses if anything about it changed.
--
-- When: any minute :08-:52 UTC outside a freeze (it refuses otherwise and
-- writes nothing). Each call holds Midway Main Bank for well under 2 s, so it
-- is safe during play; one call per few seconds, 222 calls in all.
--
-- Run as the postgres session (Supabase CLI `db query --linked` or the SQL
-- editor), never through PostgREST.

-- 1. Preview (writes nothing). Expect remaining_charges 2220, remaining_chips 17931.00.
BEGIN;
SET LOCAL statement_timeout = '2s';
SELECT smarter_private.horse_refund_parity_back_refund(0);
COMMIT;

-- 2. Pay one batch of ten. Repeat this block until refunded_charges is 0
--    (about 222 times); each repetition is its own short transaction.
BEGIN;
SET LOCAL statement_timeout = '2s';
SELECT smarter_private.horse_refund_parity_back_refund(10);
COMMIT;

-- 3. Verify (read only).
SELECT count(*) AS charges, sum(amount) AS chips, count(DISTINCT tournament_id) AS events,
       count(DISTINCT user_id) AS horses
  FROM smarter_private.horse_refund_parity_receipts;               -- expect 2220 / 17931.00 / 114 / 856
SELECT count(*), sum(amount) FROM public.chip_ledger
 WHERE idempotency_key = ANY (ARRAY(SELECT idempotency_key FROM smarter_private.horse_refund_parity_receipts)); -- expect 2220 / 17931.00
SELECT count(*), sum(amount) FROM public.ca_manual_adjustments
 WHERE decision_note = 'migration 20261108215333_horses_are_refunded_exactly_as_humans' AND status = 'settled'; -- expect 2220 / 17931.00
