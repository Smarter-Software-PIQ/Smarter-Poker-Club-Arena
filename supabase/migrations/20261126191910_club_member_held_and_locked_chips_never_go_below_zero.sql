-- @install-window: daily-maintenance
-- @locks: public.club_members
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.club_members'::regclass AND conname='club_members_held_chips_nonneg' AND convalidated) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.club_members'::regclass AND conname='club_members_locked_chips_nonneg' AND convalidated) AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.club_members'::regclass AND polname IN ('Users can join clubs','club_members_update')))
-- CLUB MEMBER HELD AND LOCKED CHIPS NEVER GO BELOW ZERO.
--
-- chip_balance and promo_balance carry validated CHECK (>= 0) constraints;
-- held_chips and locked_chips, which hold chips in escrow and at tables, had
-- none. A negative held or locked amount is chips created from nothing when
-- it is released. Production holds no negative row (checked 2026-11-26, 2,634
-- rows), so both constraints validate at once.
--
-- 20261126191556 revoked INSERT and UPDATE on club_members from every browser
-- role, which leaves the browser INSERT policy "Users can join clubs" and the
-- UPDATE policy "club_members_update" unreachable. They are dropped so no later
-- grant can bring their old reach back. Both statements take ACCESS EXCLUSIVE
-- on a table every buy-in reads, so this file installs in the 04:00 break.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE public.club_members
  ADD CONSTRAINT club_members_held_chips_nonneg CHECK (held_chips IS NULL OR held_chips >= 0),
  ADD CONSTRAINT club_members_locked_chips_nonneg CHECK (locked_chips IS NULL OR locked_chips >= 0);

DROP POLICY IF EXISTS "Users can join clubs" ON public.club_members;
DROP POLICY IF EXISTS club_members_update ON public.club_members;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_members'::regclass
                  AND conname = 'club_members_held_chips_nonneg' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_members'::regclass
                  AND conname = 'club_members_locked_chips_nonneg' AND convalidated) THEN
    RAISE EXCEPTION 'held_chips and locked_chips must carry validated zero floors';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.club_members'::regclass
              AND polcmd IN ('a', 'w') AND NOT ('service_role'::regrole = ANY (polroles))) THEN
    RAISE EXCEPTION 'a browser INSERT or UPDATE policy remains on club_members';
  END IF;
END $post$;

COMMIT;
