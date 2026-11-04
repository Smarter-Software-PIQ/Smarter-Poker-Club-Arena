-- 20261102205742_kings_club_stats_show_only_real_players
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 20:57:42 UTC.
--
-- Owner instruction (Dan, 2026-11-02 13:26 CT, verbatim): "MAKE SURE YOU REMOVE
-- ALL THE LIFE TIME HORSE STATS FROM THE KINGS CLUB, TO THE AGENTS NEW CLUB AS
-- WELL, I WANT TO SEE NOTHING BUT REAL PLAYER NUMBERS FROM KINGS CLUB ONLY".
-- This is the owner's explicit ruling for one club after the horse club split
-- (20261102141229): Kings Club has no horses, so its player statistics show
-- real players only. It is not an is_horse filter on anyone else's report:
-- every other club, the union and every ledger keep counting horses (10.5).
--
-- How. Settled rollups and source facts are NOT rewritten: rake, invoices,
-- rakeback bases, conservation checks and agent commissions keep reading the
-- original rows, and Kings keeps the money it collected in its books. Instead
-- the club player-statistics READERS read through attribution views:
--   * a Kings row of a horse with a club assignment is read as that horse's
--     assigned club (Deep Stack Society or The Felt Society), so its lifetime
--     history follows it to its new club;
--   * a Kings row of any other horse is not read as Kings at all;
--   * every other row is read unchanged.
-- Readers patched: Club Data players (page, breakdown, export), Club Data
-- games, roster / member record, top players, leaderboards, member counts.
-- Period leaderboards drop Kings horse rows and attribute assigned horses by
-- their assigned club; All Time attributes lifetime totals to the new club.
-- Member counts stop counting the horse memberships Kings still holds while
-- their pre-split union tournament entries settle.
-- @live-proof: position('ca_stats_member_record_daily_facts' IN pg_get_functiondef('public.ca_club_roster_rows(uuid)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- Kings Club row of a horse: read as its assigned club, or not at all.
CREATE FUNCTION public.fn_ca_stats_counts_in_club(p_club_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p_club_id IS DISTINCT FROM 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_horse IS TRUE)
$$;

-- Home club for leaderboard attribution: a horse's assigned club wins.
CREATE FUNCTION public.fn_ca_stats_home_club(p_user_id uuid, p_club_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT a.club_id FROM public.ca_horse_club_assignments a WHERE a.horse_id = p_user_id),
    CASE WHEN public.fn_ca_stats_counts_in_club(p_club_id, p_user_id) THEN p_club_id END)
$$;

CREATE VIEW public.ca_stats_club_member_daily_stats AS
SELECT r.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won,
       r.profit, r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
  FROM public.club_member_daily_stats r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
UNION ALL
SELECT a.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won,
       r.profit, r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
  FROM public.club_member_daily_stats r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
 WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid;

CREATE VIEW public.ca_stats_club_player_daily AS
SELECT r.club_id, r.user_id, r.stat_date, r.cash_net, r.tournament_net, r.updated_at
  FROM public.ca_club_player_daily r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
UNION ALL
SELECT a.club_id, r.user_id, r.stat_date, r.cash_net, r.tournament_net, r.updated_at
  FROM public.ca_club_player_daily r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
 WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid;

-- A moved row carries its new club's launch accounting cutoff only when it
-- was current under Kings' cutoff; anything else never matches a reader.
CREATE VIEW public.ca_stats_member_record_daily_facts AS
SELECT r.club_id, r.user_id, r.played_on, r.game_variant, r.is_mtt, r.hands, r.wins, r.vpip_hands,
       r.pfr_hands, r.tb_hands, r.faced_tb, r.folded_tb, r.cb_hands, r.cb_opps, r.fees, r.net,
       r.accounting_cutoff
  FROM public.member_record_daily_facts r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
UNION ALL
SELECT a.club_id, r.user_id, r.played_on, r.game_variant, r.is_mtt, r.hands, r.wins, r.vpip_hands,
       r.pfr_hands, r.tb_hands, r.faced_tb, r.folded_tb, r.cb_hands, r.cb_opps, r.fees, r.net,
       CASE WHEN r.accounting_cutoff IS NOT DISTINCT FROM
                 (SELECT public.fn_ca_launch_accounting_cutoff('club', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid))
            THEN CASE a.club_id
                   WHEN '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid
                   THEN (SELECT public.fn_ca_launch_accounting_cutoff('club', '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
                   ELSE (SELECT public.fn_ca_launch_accounting_cutoff('club', 'a0000000-0000-0000-0000-000000000001'::uuid))
                 END
            ELSE '-infinity'::timestamptz END
  FROM public.member_record_daily_facts r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
 WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid;

CREATE VIEW public.ca_stats_club_data_fact_ct AS
SELECT r.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
  FROM public.ca_club_data_fact_ct r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
UNION ALL
SELECT a.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
  FROM public.ca_club_data_fact_ct r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
 WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid;

CREATE VIEW public.ca_stats_club_tournament_player_daily AS
SELECT r.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
  FROM public.ca_club_tournament_player_daily r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
UNION ALL
SELECT a.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
  FROM public.ca_club_tournament_player_daily r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
 WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid;

-- Period leaderboards subtract snapshots from totals per (user, club), so
-- they read Kings without its horse rows (no rows move between clubs).
CREATE VIEW public.ca_stats_player_stats_real AS
SELECT r.* FROM public.player_stats r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE);

CREATE VIEW public.ca_stats_player_stats_snapshots_real AS
SELECT r.* FROM public.player_stats_snapshots r
 WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE);

-- All Time: lifetime totals summed under the club that now owns the player.
CREATE VIEW public.ca_stats_player_stats_lifetime AS
SELECT g.user_id, g.club_id,
       sum(g.hands_played)::bigint AS hands_played, sum(g.total_winnings) AS total_winnings,
       sum(g.total_losses) AS total_losses, sum(g.total_rake) AS total_rake,
       sum(g.tournaments_played)::bigint AS tournaments_played, sum(g.tournaments_won)::bigint AS tournaments_won,
       sum(g.hands_dealt)::bigint AS hands_dealt, sum(g.sum_big_blind) AS sum_big_blind
  FROM (
    SELECT r.user_id, r.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake,
           r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats r
     WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
        OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
    UNION ALL
    SELECT r.user_id, a.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake,
           r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats r
      JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
     WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
  ) g
 GROUP BY g.user_id, g.club_id;

CREATE VIEW public.ca_stats_player_stats_snapshots_lifetime AS
SELECT g.user_id, g.club_id, g.snapshot_date,
       sum(g.hands_played)::bigint AS hands_played, sum(g.total_winnings) AS total_winnings,
       sum(g.total_losses) AS total_losses, sum(g.total_rake) AS total_rake,
       sum(g.tournaments_played)::bigint AS tournaments_played, sum(g.tournaments_won)::bigint AS tournaments_won,
       sum(g.hands_dealt)::bigint AS hands_dealt, sum(g.sum_big_blind) AS sum_big_blind
  FROM (
    SELECT r.user_id, r.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses,
           r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats_snapshots r
     WHERE r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
        OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE)
    UNION ALL
    SELECT r.user_id, a.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses,
           r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats_snapshots r
      JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id
     WHERE r.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
  ) g
 GROUP BY g.user_id, g.club_id, g.snapshot_date;

-- Read only by the SECURITY DEFINER readers below (owner postgres).
REVOKE ALL ON public.ca_stats_club_member_daily_stats, public.ca_stats_club_player_daily,
  public.ca_stats_member_record_daily_facts, public.ca_stats_club_data_fact_ct,
  public.ca_stats_club_tournament_player_daily, public.ca_stats_player_stats_real,
  public.ca_stats_player_stats_snapshots_real, public.ca_stats_player_stats_lifetime,
  public.ca_stats_player_stats_snapshots_lifetime
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_stats_club_member_daily_stats, public.ca_stats_club_player_daily,
  public.ca_stats_member_record_daily_facts, public.ca_stats_club_data_fact_ct,
  public.ca_stats_club_tournament_player_daily, public.ca_stats_player_stats_real,
  public.ca_stats_player_stats_snapshots_real, public.ca_stats_player_stats_lifetime,
  public.ca_stats_player_stats_snapshots_lifetime
  TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_stats_counts_in_club(uuid, uuid), public.fn_ca_stats_home_club(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_stats_counts_in_club(uuid, uuid), public.fn_ca_stats_home_club(uuid, uuid)
  TO service_role;

DO $migration$
DECLARE
  -- function, old text, new text, replace every occurrence
  v_edits text[][] := ARRAY[
    ['public.ca_club_top_players(uuid,timestamp with time zone,integer,text)',
     'FROM club_member_daily_stats s', 'FROM public.ca_stats_club_member_daily_stats s'],
    ['public.ca_club_player_page_core_20261006(uuid,date,date,text,text,jsonb,integer)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_club_player_page_core_20261006(uuid,date,date,text,text,jsonb,integer)',
     'public.ca_club_player_daily d', 'public.ca_stats_club_player_daily d'],
    ['public.ca_club_player_breakdown(uuid,date,date,integer)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_club_player_breakdown(uuid,date,date,integer)',
     'public.ca_club_player_daily d', 'public.ca_stats_club_player_daily d'],
    ['public.ca_club_player_export_start(uuid,date,date,text,uuid)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_club_player_export_start(uuid,date,date,text,uuid)',
     'public.ca_club_player_daily d', 'public.ca_stats_club_player_daily d'],
    ['public.ca_club_roster_rows(uuid)',
     'public.member_record_daily_facts r', 'public.ca_stats_member_record_daily_facts r'],
    ['public.ca_club_members(uuid,text,timestamp with time zone,integer,integer,text,text)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_club_members_cash_window(uuid,uuid[],date,date)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_member_record_daily_facts(uuid,uuid,date,date)',
     'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'],
    ['public.ca_club_data_screen(uuid,date,date,text,text,text,integer)',
     'public.ca_club_data_fact_ct ', 'public.ca_stats_club_data_fact_ct '],
    ['public.ca_club_game_page_core_20261006(uuid,date,date,text,text,text,text,jsonb,integer)',
     'public.ca_club_data_fact_ct ', 'public.ca_stats_club_data_fact_ct '],
    ['public.fn_ca_club_game_recent_rows(uuid,date,date,integer)',
     'public.ca_club_data_fact_ct ', 'public.ca_stats_club_data_fact_ct '],
    ['public.fn_ca_club_games_searched(uuid,date,date,text,text,text)',
     'public.ca_club_data_fact_ct ', 'public.ca_stats_club_data_fact_ct '],
    ['public.fn_ca_club_games_unsearched(uuid,date,date,text,text)',
     'public.ca_club_data_fact_ct ', 'public.ca_stats_club_data_fact_ct '],
    ['public.fn_ca_club_game_rows(uuid,date,date,text,text,text,integer)',
     'public.ca_club_tournament_player_daily p', 'public.ca_stats_club_tournament_player_daily p'],
    ['public.fn_ca_club_game_rows_filtered(uuid,date,date,text,text,text,integer)',
     'public.ca_club_tournament_player_daily p', 'public.ca_stats_club_tournament_player_daily p'],
    -- All Time (and the non-union branch): lifetime totals under the new club.
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'      FROM public.player_stats ps\n      LEFT JOIN public.player_stats_snapshots b\n        ON NOT v_is_all_time',
     E'      FROM public.ca_stats_player_stats_lifetime ps\n      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime b\n        ON NOT v_is_all_time'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'      LEFT JOIN public.player_stats_snapshots pe\n        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=v_prev_end',
     E'      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime pe\n        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=v_prev_end'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'      LEFT JOIN public.player_stats_snapshots pv\n        ON NOT v_is_all_time',
     E'      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime pv\n        ON NOT v_is_all_time'],
    -- Periods: union play attributed to a horse's assigned club, never Kings.
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'     WHERE a.club_id=p_club_id\n  ), union_scope',
     E'     WHERE public.fn_ca_stats_home_club(a.user_id, a.club_id)=p_club_id\n  ), union_scope'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     'public.player_stats_snapshots', 'public.ca_stats_player_stats_snapshots_real'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     'public.player_stats ps', 'public.ca_stats_player_stats_real ps'],
    ['public.fn_club_leaderboard_by_dates(uuid,text,date,date,integer,integer)',
     E'        FROM inputs d\n      ), ranked',
     E'        FROM inputs d\n       WHERE public.fn_ca_stats_counts_in_club(p_club_id, d.user_id)\n      ), ranked'],
    ['public.fn_club_leaderboard_by_dates(uuid,text,date,date,integer,integer)',
     'public.player_stats_snapshots', 'public.ca_stats_player_stats_snapshots_real'],
    ['public.fn_club_leaderboard_by_dates(uuid,text,date,date,integer,integer)',
     'public.player_stats ps', 'public.ca_stats_player_stats_real ps'],
    -- Member counts.
    ['public.fn_batch_club_member_counts(uuid[])',
     E'    AND (cm.status IS NULL OR cm.status IN (''active'', ''approved''))\n  GROUP BY cm.club_id;',
     E'    AND (cm.status IS NULL OR cm.status IN (''active'', ''approved''))\n    AND public.fn_ca_stats_counts_in_club(cm.club_id, cm.user_id)\n  GROUP BY cm.club_id;'],
    ['public.fn_batch_club_realtime_member_counts(uuid[])',
     E'      AND (cm.status IS NULL OR cm.status IN (''active'', ''approved''))\n   GROUP BY requested.club_id;',
     E'      AND (cm.status IS NULL OR cm.status IN (''active'', ''approved''))\n      AND public.fn_ca_stats_counts_in_club(cm.club_id, cm.user_id)\n   GROUP BY requested.club_id;'],
    ['public.fn_club_member_count(uuid)',
     E'    AND cm.status IN (''active'', ''approved'');',
     E'    AND cm.status IN (''active'', ''approved'')\n    AND public.fn_ca_stats_counts_in_club(cm.club_id, cm.user_id);'],
    ['public.fn_get_club_member_count(uuid)',
     E'    AND (status IS NULL OR status IN (''active'', ''approved''));',
     E'    AND (status IS NULL OR status IN (''active'', ''approved''))\n    AND public.fn_ca_stats_counts_in_club(club_id, user_id);'],
    ['public.fn_club_member_counts(uuid)',
     E'  WHERE club_id = p_club_id;',
     E'  WHERE club_id = p_club_id\n    AND public.fn_ca_stats_counts_in_club(club_id, user_id);']
  ];
  v_fn text := NULL;
  v_def text;
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_edits, 1) LOOP
    IF v_fn IS DISTINCT FROM v_edits[i][1] THEN
      IF v_fn IS NOT NULL THEN EXECUTE v_def; END IF;
      v_fn := v_edits[i][1];
      v_def := pg_get_functiondef(v_fn::regprocedure);
    END IF;
    IF position(v_edits[i][2] IN v_def) = 0 THEN
      RAISE EXCEPTION 'kings real-player stats: % no longer contains %', v_fn, v_edits[i][2];
    END IF;
    v_def := replace(v_def, v_edits[i][2], v_edits[i][3]);
  END LOOP;
  EXECUTE v_def;
END;
$migration$;

DO $verify$
BEGIN
  IF position('public.member_record_daily_facts ' IN pg_get_functiondef('public.ca_club_roster_rows(uuid)'::regprocedure)) > 0
     OR position('public.player_stats_snapshots ' IN pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure)) > 0
     OR position('FROM club_member_daily_stats' IN pg_get_functiondef('public.ca_club_top_players(uuid,timestamp with time zone,integer,text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'kings real-player stats: a reader still reads the raw rollup';
  END IF;
END;
$verify$;

COMMIT;
