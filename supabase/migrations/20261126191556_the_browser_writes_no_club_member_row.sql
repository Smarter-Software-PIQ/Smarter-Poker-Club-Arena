-- THE BROWSER WRITES NO CLUB MEMBER ROW.
--
-- club_members holds every player's chip_balance, promo_balance, held_chips and
-- locked_chips, plus promo playthrough, diamonds, commission and rakeback
-- columns. Until now the authenticated role kept table-wide INSERT and UPDATE
-- on it, so the row policy "club_members_update" let a player update their own
-- row and a club admin update any row in the club. Balance columns were held
-- only by triggers that inspect current_user (fn_block_browser_balance_writes,
-- fn_block_browser_balance_inserts, fn_membership_starts_with_zero_chips);
-- every other column (promo_playthrough_required, diamonds, commission_rate,
-- rakeback_rate, trust_score, tier, totals) was writable from the browser.
--
-- Nothing legitimate needs that grant. Joining, leaving, role changes,
-- rakeback agreements and every chip movement run through SECURITY DEFINER
-- RPCs (fn_join_club, fn_join_club_atomic, fn_review_join_request,
-- fn_member_leave_to_treasury, fn_club_set_member_role and the money RPCs),
-- which run as their owner and are unaffected. pg_stat_statements since
-- 2026-10-04 records no PostgREST INSERT or UPDATE on club_members by a browser
-- role; every one was service_role. The one client write
-- (ClubsService.leaveClub clearing agent_id) is removed in the same change; it
-- could not pass the row policy for an agent and its error was discarded.
--
-- The grant is the root: with it gone, no policy, trigger or runtime setting
-- has to stay correct for a browser to be unable to write this table.
-- @live-proof: (SELECT NOT has_table_privilege('authenticated', 'public.club_members', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.club_members', 'UPDATE') AND NOT has_any_column_privilege('authenticated', 'public.club_members', 'UPDATE') AND NOT has_any_column_privilege('authenticated', 'public.club_members', 'INSERT') AND NOT has_any_column_privilege('anon', 'public.club_members', 'UPDATE') AND has_table_privilege('service_role', 'public.club_members', 'INSERT,UPDATE,DELETE') AND has_column_privilege('authenticated', 'public.club_members', 'club_id', 'SELECT'))

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '30s';

REVOKE INSERT, UPDATE ON TABLE public.club_members FROM PUBLIC, anon, authenticated;

DO $post$
DECLARE
  v text;
BEGIN
  SELECT string_agg(format('%s %s', rl, pv), ', ') INTO v
    FROM unnest(ARRAY['anon', 'authenticated']) rl,
         unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pv
   WHERE has_table_privilege(rl, 'public.club_members', pv)
      OR (pv IN ('INSERT', 'UPDATE')
          AND has_any_column_privilege(rl, 'public.club_members', pv));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'a browser role can still write club_members: %', v;
  END IF;

  IF NOT has_table_privilege('service_role', 'public.club_members', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'the service role lost a write on club_members';
  END IF;

  -- Reads are unchanged.
  IF NOT has_column_privilege('authenticated', 'public.club_members', 'club_id', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on club_members';
  END IF;
END $post$;

COMMIT;
