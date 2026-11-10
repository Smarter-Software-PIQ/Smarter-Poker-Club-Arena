-- @install-window: daily-maintenance
-- @locks: public.tournament_players
-- 20261110003726_a_closed_persons_tournament_rows_are_read_through_the_public.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. tournament_players_public (20261109235153) answers a closed person's
-- username with the scrubbed profile's label, but the table underneath it
-- still returns the recorded name to anyone who asks the REST API for the
-- table itself: its only read policy is USING (true). A view cannot close
-- that; only the table's own policy can.
--
-- WHAT. Two RESTRICTIVE read policies, one per ordinary role, that withhold
-- the rows of a closed person (ca_closed_player_labels: status deleted, not a
-- horse). Nothing stored changes and nothing else is hidden:
--   * the view is owned by the table's owner, so it still returns every row,
--     which is how results keep every placement and payout;
--   * the service role and the engine bypass row level security as before;
--   * platform staff signed in as authenticated still read every row;
--   * a closed account can never be in a live tournament, so no read made
--     during play loses a row.
-- anon gets its own policy because anon may not execute
-- fn_is_platform_admin, and a policy that names a function its reader cannot
-- call refuses every row.
--
-- WHY THE DAILY WINDOW. CREATE POLICY takes ACCESS EXCLUSIVE on
-- tournament_players, which is written throughout play (CLAUDE.md section 2
-- rule 10). One attempt, 1 s lock_timeout, inside the 04:00 freeze.
--
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tournament_players' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND policyname IN ('a_closed_persons_rows_are_read_through_the_public_view', 'a_closed_persons_rows_are_read_through_the_public_view_anon')) = 2

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE POLICY a_closed_persons_rows_are_read_through_the_public_view
  ON public.tournament_players
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.fn_is_platform_admin())
    OR NOT EXISTS (
      SELECT 1 FROM public.ca_closed_player_labels closed
       WHERE closed.id = tournament_players.user_id)
  );

CREATE POLICY a_closed_persons_rows_are_read_through_the_public_view_anon
  ON public.tournament_players
  AS RESTRICTIVE
  FOR SELECT
  TO anon
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.ca_closed_player_labels closed
       WHERE closed.id = tournament_players.user_id)
  );

COMMIT;
