-- 20261109235153_a_closed_persons_tournament_name_is_read_through_the_public_.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. tournament_players.username is the name a player held when they
-- registered. Closing an account scrubs the profile, but a finished or
-- cancelled tournament's rows are immutable evidence and keep that name, and
-- the column is readable by every client: results pages print it and the REST
-- API returns it. A closed person's former name stayed public.
--
-- WHAT. Nothing stored changes. Ordinary clients get a read surface that
-- answers with the closed profile's own label instead of the recorded name:
--   * ca_closed_player_labels: the closed, non-horse profiles and the label
--     their scrubbed profile carries now. Retired horses are house characters,
--     not people, and keep their names in past results.
--   * tournament_players_public: every tournament_players column, same names,
--     with username answered from that label for a closed person. Platform
--     staff still read the recorded name. The join is dropped by the planner
--     whenever username is not selected.
--   * the four results functions that returned tp.username now read the same
--     view, so an RPC cannot answer with a name the view withholds.
-- The base table itself is closed to ordinary readers for those rows by a
-- separate daily-maintenance migration (a policy needs ACCESS EXCLUSIVE).
--
-- The partial index serves the per-row probe that policy makes, and the join
-- here. It is built CONCURRENTLY in the door's one sanctioned shape
-- (scripts/ci/migration-concurrent-preamble.mjs): profiles is written
-- constantly and a plain CREATE INDEX would hold SHARE for the build.
--
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: to_regclass('public.tournament_players_public') IS NOT NULL AND has_table_privilege('anon', 'public.tournament_players_public', 'SELECT') AND has_table_privilege('authenticated', 'public.tournament_players_public', 'SELECT') AND NOT has_table_privilege('anon', 'public.tournament_players_public', 'INSERT, UPDATE, DELETE') AND position('tournament_players_public' IN pg_get_functiondef('public.fn_spin_leaderboards(integer)'::regprocedure)) > 0 AND position('tournament_players_public' IN pg_get_functiondef('public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure)) > 0 AND position('tournament_players_public' IN pg_get_functiondef('public.fn_mystery_bounty_leaderboard(uuid)'::regprocedure)) > 0 AND position('tournament_players_public' IN pg_get_functiondef('public.fn_mystery_bounty_table_state(uuid)'::regprocedure)) > 0

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_closed_person ON public.profiles USING btree (id) WHERE status = 'deleted' AND is_horse IS NOT TRUE;

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $$
DECLARE
  v_valid boolean;
BEGIN
  SELECT i.indisvalid INTO v_valid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE n.nspname = 'public' AND c.relname = 'idx_profiles_closed_person';
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'idx_profiles_closed_person is missing or INVALID; drop it and dispatch again';
  END IF;
END;
$$;

CREATE VIEW public.ca_closed_player_labels AS
SELECT p.id,
       COALESCE(NULLIF(btrim(p.username), ''), 'Player') AS label
  FROM public.profiles p
 WHERE p.status = 'deleted' AND p.is_horse IS NOT TRUE;

REVOKE ALL ON public.ca_closed_player_labels FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_closed_player_labels TO anon, authenticated, service_role;

COMMENT ON VIEW public.ca_closed_player_labels IS
  'Closed, non-horse profiles and the label their scrubbed profile carries. The one definition of a closed person for tournament_players_public and for the tournament_players read policy.';

CREATE VIEW public.tournament_players_public AS
SELECT tp.id,
       tp.tournament_id,
       tp.user_id,
       CASE
         WHEN closed.id IS NULL THEN tp.username
         WHEN (SELECT public.fn_is_platform_admin()) THEN tp.username
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

REVOKE ALL ON public.tournament_players_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.tournament_players_public TO anon, authenticated, service_role;

COMMENT ON VIEW public.tournament_players_public IS
  'The read surface for tournament players. Same columns as tournament_players; username is the closed profile label for a closed person unless the reader is platform staff. Stored rows are never changed.';

-- The four results functions that answered with tp.username read the view.
-- Each body is production's own, with the relation swapped and the number of
-- swaps asserted, so an unexpected body is refused instead of half patched.
DO $patch$
DECLARE
  r record;
  d text;
  n integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure, 2),
      ('public.fn_mystery_bounty_leaderboard(uuid)'::regprocedure, 1),
      ('public.fn_mystery_bounty_table_state(uuid)'::regprocedure, 3),
      ('public.fn_spin_leaderboards(integer)'::regprocedure, 1)
    ) AS t(sig, expected)
  LOOP
    d := pg_get_functiondef(r.sig);
    IF position('public.tournament_players_public ' IN d) > 0 THEN
      RAISE EXCEPTION '% already reads the public view', r.sig;
    END IF;
    n := (length(d) - length(replace(d, 'public.tournament_players ', '')))
         / length('public.tournament_players ');
    IF n <> r.expected THEN
      RAISE EXCEPTION '% reads tournament_players % time(s), expected %', r.sig, n, r.expected;
    END IF;
    d := replace(d, 'public.tournament_players ', 'public.tournament_players_public ');
    EXECUTE d;
    IF position('public.tournament_players ' IN pg_get_functiondef(r.sig)) > 0 THEN
      RAISE EXCEPTION '% still reads the base table', r.sig;
    END IF;
  END LOOP;
END;
$patch$;

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
