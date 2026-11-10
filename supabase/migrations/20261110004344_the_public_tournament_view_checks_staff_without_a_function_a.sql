-- 20261110004344_the_public_tournament_view_checks_staff_without_a_function_a.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. tournament_players_public (20261109235153) decides whether the reader
-- is platform staff by calling fn_is_platform_admin(). A function named in a
-- view is called with the READER's privileges, not the view owner's, and anon
-- may not execute that function. So a signed-out reader asking the view for
-- username would be refused outright ("permission denied for function"),
-- which was found by reading the grants before any client asked the view.
--
-- WHAT. The same view, same columns in the same order, with the staff test
-- written as a read of profiles. A table named in a view is read with the
-- view owner's privileges, so it answers for every reader; auth.uid() is
-- executable by anon and is NULL for a signed-out reader, which is not staff.
-- The test does not depend on the row, so it runs once per query.
-- Nothing else about the view, its grants or its rows changes.
--
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: position('fn_is_platform_admin' IN pg_get_viewdef('public.tournament_players_public'::regclass)) = 0 AND position('auth.uid()' IN pg_get_viewdef('public.tournament_players_public'::regclass)) > 0 AND has_table_privilege('anon', 'public.tournament_players_public', 'SELECT') AND has_table_privilege('authenticated', 'public.tournament_players_public', 'SELECT')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE VIEW public.tournament_players_public AS
SELECT tp.id,
       tp.tournament_id,
       tp.user_id,
       CASE
         WHEN closed.id IS NULL THEN tp.username
         WHEN EXISTS (
           SELECT 1 FROM public.profiles reader
            WHERE reader.id = (SELECT auth.uid())
              AND reader.role IN ('admin', 'superadmin', 'god')
         ) THEN tp.username
         ELSE closed.label
       END AS username,
       tp.chips,
       tp.status,
       tp."position",
       tp.prize,
       tp.rebuys,
       tp.add_on,
       tp.registered_at,
       tp.eliminated_at,
       tp.bounties_collected,
       tp.bounty_winnings,
       tp.mystery_bounty_value,
       tp.current_bounty,
       tp.table_id,
       tp.seat_number,
       tp.chip_count,
       tp.club_id,
       tp.is_satellite_qualifier,
       tp.rebuy_prompt_until,
       tp.push_15m_sent,
       tp.push_2m_sent,
       tp.source_satellite_id,
       tp.elimination_sequence,
       tp.terminal_closed_at
  FROM public.tournament_players tp
  LEFT JOIN public.ca_closed_player_labels closed ON closed.id = tp.user_id;

-- The access boundary is restated with the definition, unchanged.
REVOKE ALL ON public.tournament_players_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.tournament_players_public TO anon, authenticated, service_role;

DO $$
DECLARE
  v_base integer;
  v_view integer;
BEGIN
  SELECT count(*) INTO v_base FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tournament_players';
  SELECT count(*) INTO v_view FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tournament_players_public';
  IF v_base <> v_view THEN
    RAISE EXCEPTION 'tournament_players has % columns and its public view %', v_base, v_view;
  END IF;
END;
$$;

COMMIT;
