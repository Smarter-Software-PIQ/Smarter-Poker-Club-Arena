-- 20261110144739_a_spin_waits_out_its_horse_ladder.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT unfilled_timeout_minutes FROM public.spin_fill_policy) = 160 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spin_fill_policy_covers_the_horse_ladder' AND conrelid = 'public.spin_fill_policy'::regclass)
--
-- A SPIN WAITS OUT ITS HORSE LADDER (2026-11-10, measured on 840429a3).
--
-- Dan's Spin ladder: one horse opens a Spin, "AFTER 1 HOURS TO 1:20 MINUTES
-- WITH NO HUMANS A SECOND HORSE SITS FOR SPINS, AND THEN WITHIN THE NEXT
-- 30-60 MIN A 3RD HORSE WILL SIT" (server/src/config/seatFirstLadder.ts,
-- SPIN_LADDER: 60-80 then 30-60 minutes, so up to 140 minutes to deal).
--
-- fn_spin_expire_unfilled (engine, every 10 minutes) cancels and refunds any
-- unfilled Spin whose seated player has waited longer than
-- spin_fill_policy.unfilled_timeout_minutes, set to 30 on 2026-08-31 when a
-- Spin's opening window was 90-350 seconds. Under the ladder every
-- horse-opened Spin is past 30 minutes long before its first rung, so it was
-- cancelled and refunded instead of climbing. Read from production at 14:40Z:
-- 40 house Spins created 12:01-14:09Z were CANCELLED by atomic_cancel_tournament
-- after an average 38 minutes, 40 of 40 entries refunded in full (998.00
-- chips), and no Spin started on the new engine at all.
--
-- The rule stays the same for everyone (CLAUDE.md 10.5: no is_horse branch).
-- A person who sits is joined within 3 to 7 minutes, so only the designed
-- ladder can wait this long; the timeout is set past the ladder's longest
-- wait (140) plus one sweep interval and margin: 160. The constraint keeps
-- it there: 0 (disabled) or at least 150, so a timeout shorter than the
-- ladder cannot be configured again. tests/a-spin-waits-out-its-horse-ladder
-- .law.test.ts ties the 150 to SPIN_LADDER, so neither can move alone.
--
-- One small config table, read once per sweep; no hot-table lock.

BEGIN;

UPDATE public.spin_fill_policy
   SET unfilled_timeout_minutes = 160,
       updated_at = now()
 WHERE id;

ALTER TABLE public.spin_fill_policy
  ADD CONSTRAINT spin_fill_policy_covers_the_horse_ladder
  CHECK (unfilled_timeout_minutes = 0 OR unfilled_timeout_minutes >= 150);

DO $$
BEGIN
  IF (SELECT unfilled_timeout_minutes FROM public.spin_fill_policy) IS DISTINCT FROM 160 THEN
    RAISE EXCEPTION 'spin_fill_policy did not take the ladder timeout';
  END IF;
END
$$;

COMMIT;
