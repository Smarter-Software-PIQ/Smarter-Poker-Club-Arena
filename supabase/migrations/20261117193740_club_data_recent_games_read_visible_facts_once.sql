-- 20261117193740_club_data_recent_games_read_visible_facts_once.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

BEGIN;

-- Read visible game facts once rather than three lateral scans per game.
-- Measured Midway Nov9..15: ordered 100-row query 1447ms -> 725ms;
-- read-only old/new ordered JSON equality proved before submission.
-- @live-proof: position('visible_facts AS MATERIALIZED' IN pg_get_functiondef('public.fn_ca_club_game_recent_rows_union_basis(uuid,date,date,integer)'::regprocedure))>0
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_club_game_recent_rows_union_basis(uuid,date,date,integer)'::regprocedure)) <> 'dfde9606d3f9cd303d412b4938141007' THEN
    RAISE EXCEPTION 'Club Data recent rows source changed';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_game_recent_rows_union_basis(p_club_id uuid, p_start date, p_end date, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit,100),200),1);
  v_bound timestamptz;
  v_out jsonb;
BEGIN
  /* THE NEWEST GAMES, READ NEWEST FIRST (20261022165130).

     ca_club_data_snapshot_v2 shows the unfiltered game page's rows in its
     'recent' order: newest start first (a cash table's created_at, a
     tournament's start_time), then kind, then id. ca_club_game_page_core
     ranks every game of the window to pick them, which for a large club is
     200,000 tournaments read from tournaments every call (4 to 6 s). Here the
     tournaments are walked newest first down idx_tournaments_start_time,
     keeping those this club played in the window, and they stop at the
     page's size: the top of every game is the top of the cash tables (read
     whole, as before) and the top tournaments.

     The walk goes no further than the 20,000th newest start ($10), and reads
     the reporting clubs once ($11, fn_ca_club_data_clubs) rather than once
     per tournament walked. When the
     page's last tournament is newer than that bound every tournament that
     could outrank it was walked, and the rows are the page's rows exactly;
     otherwise this answers NULL and the caller reads the page as before.
     Every row is described by the page's own detail query; for a union the
     raked hands are counted for the page's cash tables only, by the same
     filter as the page's union_hands. The caller has authorized the viewer
     (ca_can_view_whole_club_report). */
  SELECT tr.start_time INTO v_bound FROM public.tournaments tr
   WHERE tr.start_time IS NOT NULL ORDER BY tr.start_time DESC OFFSET 20000 LIMIT 1;
  v_bound := COALESCE(v_bound, '-infinity'::timestamptz);

  EXECUTE $query$
    WITH felt AS MATERIALIZED (SELECT * FROM public.fn_ca_club_cash_felt($1,$2,$3,$4,$5,$6)), raw_cash AS (
      SELECT c.table_id,SUM(c.rake) fee,SUM(c.net) winnings,SUM(c.hands)::bigint hands
        FROM (SELECT g.game_id AS table_id,g.fee AS rake,g.winnings AS net,0::bigint AS hands
                FROM public.ca_club_acct_fact_ct g
               WHERE g.kind='CASH' AND g.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND g.stat_date BETWEEN $2 AND $3
              UNION ALL
              SELECT h.table_id,0,0,h.hands
                FROM public.ca_club_acct_hands_ct h
               WHERE h.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND h.stat_date BETWEEN $2 AND $3) c
       GROUP BY c.table_id
    ), cash AS (
      SELECT coalesce(c.table_id,f.table_id) table_id,coalesce(c.fee,0) fee,
             coalesce(c.winnings,0) winnings,coalesce(f.felt,0) on_felt,coalesce(c.hands,0)::bigint hands,
             coalesce(f.seated,0)::integer seated
        FROM raw_cash c FULL JOIN felt f ON f.table_id=c.table_id
    ), tour_top AS MATERIALIZED (
      SELECT tr.id,tr.start_time,tr.tournament_type
        FROM public.tournaments tr
       WHERE tr.start_time >= $10
         AND EXISTS (SELECT 1 FROM public.ca_club_acct_fact_ct d
                      WHERE d.kind='TOURNAMENT' AND d.club_id = ANY ($11)
                        AND d.game_id=tr.id AND d.stat_date BETWEEN $2 AND $3)
       ORDER BY tr.start_time DESC,
                CASE WHEN tr.tournament_type='SPIN' THEN 'SPIN'
                     WHEN tr.tournament_type='SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END DESC,
                tr.id::text DESC
       LIMIT $9
    ), keys AS MATERIALIZED (
      -- The ranking set carries the four sort keys and NOTHING the page does
      -- not filter on. Every other column is presentation, it is needed for at
      -- most $9 rows, and carrying it here is what spilled 42 MB to disk three
      -- times per read.
      SELECT 'CASH'::text kind,t.id::text id,
             CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%'
                        OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                  WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%'
                        OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                  ELSE 'HOLDEM' END game_class,
             CASE WHEN COALESCE(t.big_blind,0)<1 THEN 'MICRO'
                  WHEN COALESCE(t.big_blind,0)<5 THEN 'SMALL'
                  WHEN COALESCE(t.big_blind,0)<25 THEN 'MID' ELSE 'HIGH' END stakes_tier,
             COALESCE(t.name,'Unnamed') name,COALESCE(pr.username,'') creator_name,
             CASE $7 WHEN 'fee' THEN round(c.fee,2)
                     WHEN 'winnings' THEN round(c.winnings,2)
                     WHEN 'hands' THEN c.hands::numeric
                     ELSE extract(epoch FROM COALESCE(t.created_at,'0001-01-01'::timestamptz))::numeric
              END sort_value,
             extract(epoch FROM COALESCE(t.created_at,'0001-01-01'::timestamptz))::numeric sort_time
        FROM cash c JOIN public.tables t ON t.id=c.table_id
        LEFT JOIN public.profiles pr ON pr.id=t.created_by
      UNION ALL
      SELECT CASE WHEN tr.tournament_type='SPIN' THEN 'SPIN'
                  WHEN tr.tournament_type='SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END,
             tr.id::text,
             CASE WHEN tr.tournament_type='SPIN' THEN 'SPIN' WHEN tr.tournament_type='SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END,
             'NA',
             NULL::text,''::text,
             extract(epoch FROM COALESCE(tr.start_time,'0001-01-01'::timestamptz))::numeric,
             extract(epoch FROM COALESCE(tr.start_time,'0001-01-01'::timestamptz))::numeric
        FROM tour_top tr
    ), visible AS MATERIALIZED (
      SELECT * FROM keys
       ORDER BY sort_value DESC,sort_time DESC,kind DESC,id DESC LIMIT $9
    ), visible_facts AS MATERIALIZED (
      SELECT d.game_id, sum(d.fee) fee, sum(d.winnings) winnings,
             count(DISTINCT nullif(d.user_id,'00000000-0000-0000-0000-000000000000'::uuid))::integer players,
             count(DISTINCT nullif(d.user_id,'00000000-0000-0000-0000-000000000000'::uuid)) FILTER (WHERE d.kind='CASH')::integer cash_players
        FROM public.ca_club_acct_fact_ct d
       WHERE d.club_id = ANY ($11) AND d.stat_date BETWEEN $2 AND $3
         AND d.game_id IN (SELECT v.id::uuid FROM visible v)
       GROUP BY d.game_id
    ), visible_hands AS MATERIALIZED (
      -- The page's union_hands, for the page's cash tables only.
      SELECT r.table_id,count(*)::bigint hands
        FROM public.rake_records r
       WHERE EXISTS(SELECT 1 FROM public.unions u WHERE u.id=$1)
         AND r.created_at>=public.fn_ca_accounting_day_start($2) AND r.created_at<public.fn_ca_accounting_day_start($3+1)
         AND r.tournament_id IS NULL AND r.is_tournament IS NOT TRUE AND r.rake_amount>0
         AND r.table_id IN (SELECT DISTINCT h.table_id FROM public.ca_club_acct_hands_ct h
                             WHERE h.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND h.stat_date BETWEEN $2 AND $3)
         AND r.table_id::text IN (SELECT v.id FROM visible v WHERE v.kind='CASH')
       GROUP BY r.table_id
    ), detail AS (
      -- Presentation, for the <=$9 rows that survived the LIMIT and no others.
      SELECT v.kind,v.id,CASE WHEN v.kind='CASH' THEN v.name ELSE COALESCE(tr.name,'Tournament') END name,
             v.game_class,v.stakes_tier,v.creator_name,
             v.sort_value,v.sort_time,
             CASE WHEN v.kind='CASH' THEN UPPER(COALESCE(t.game_variant,'nlh'))
                  ELSE UPPER(COALESCE(tr.variant,tr.game_type,'nlh')) END variant,
             CASE WHEN v.kind='CASH' THEN COALESCE(t.small_blind,0) ELSE 0::numeric END small_blind,
             CASE WHEN v.kind='CASH' THEN COALESCE(t.big_blind,0) ELSE 0::numeric END big_blind,
             CASE WHEN v.kind='CASH' AND COALESCE(t.rake_percent,-1)>=0 THEN t.rake_percent END rake_percent,
             CASE WHEN v.kind='CASH' THEN t.created_at ELSE tr.start_time END started_at,
             CASE WHEN v.kind='CASH' THEN t.created_by END created_by,
             CASE WHEN v.kind='CASH' THEN t.status ELSE tr.status END status,
             CASE WHEN v.kind='CASH' THEN round(c.fee,2) ELSE round(COALESCE(vf.fee,0),2) END fee,
             CASE WHEN v.kind='CASH' THEN c.fee ELSE coalesce(vf.fee,0) END fee_exact,
             CASE WHEN v.kind='CASH' THEN round(c.winnings,2) ELSE round(COALESCE(vf.winnings,0),2) END winnings,
             CASE WHEN v.kind='CASH' THEN CASE WHEN EXISTS(SELECT 1 FROM public.unions u WHERE u.id=$1) THEN coalesce(vh.hands,0)::bigint ELSE c.hands END ELSE 0::bigint END hands,
             CASE WHEN v.kind='CASH' THEN coalesce(c.on_felt,0) ELSE 0 END on_felt,
             CASE WHEN v.kind='CASH' THEN coalesce(c.on_felt,0)>0 ELSE tr.status='RUNNING' END live,
             CASE WHEN v.kind='CASH' THEN greatest(COALESCE(vf.cash_players,0),COALESCE(c.seated,0))::integer ELSE COALESCE(vf.players,0)::integer END players,
             CASE WHEN v.kind='CASH' THEN pr.avatar_url END creator_avatar
        FROM visible v
        LEFT JOIN cash c ON v.kind='CASH' AND c.table_id=v.id::uuid
        LEFT JOIN public.tables t ON v.kind='CASH' AND t.id=v.id::uuid
        LEFT JOIN visible_hands vh ON v.kind='CASH' AND vh.table_id=v.id::uuid
        LEFT JOIN public.profiles pr ON v.kind='CASH' AND pr.id=t.created_by
        LEFT JOIN public.tournaments tr ON v.kind<>'CASH' AND tr.id=v.id::uuid
        LEFT JOIN visible_facts vf ON vf.game_id=v.id::uuid
    )
    SELECT CASE WHEN (SELECT count(*) FROM tour_top) = $9 AND (SELECT min(t.start_time) FROM tour_top t) > $10 THEN
      COALESCE((SELECT jsonb_agg(jsonb_build_object(

        'kind',q.kind,'id',q.id,'name',q.name,'variant',q.variant,
        'game_class',q.game_class,'stakes_tier',q.stakes_tier,
        'blinds',CASE WHEN q.big_blind>0 THEN
          trim(trailing '.' from trim(trailing '0' from q.small_blind::text))||'/'||
          trim(trailing '.' from trim(trailing '0' from q.big_blind::text)) END,
        'rake_percent',q.rake_percent,'started_at',q.started_at,'status',q.status,
        'creator_id',q.created_by,'creator_name',NULLIF(q.creator_name,''),
        'creator_avatar',q.creator_avatar,'fee',q.fee,'fee_exact',q.fee_exact,'winnings',q.winnings,
        'hands',q.hands,'players',q.players,'on_felt',q.on_felt,'live',q.live)
        ORDER BY q.sort_value DESC,q.sort_time DESC,q.kind DESC,q.id DESC) FROM detail q),'[]'::jsonb) END
  $query$ INTO v_out
  USING p_club_id,p_start,p_end,'ALL'::text,'ALL'::text,NULL::text,'recent'::text,NULL::jsonb,v_limit,v_bound,
        public.fn_ca_club_data_clubs(p_club_id);

  RETURN v_out;
END;
$function$;

-- Match the installed owner-only helper ACL explicitly on replacement.
REVOKE ALL ON FUNCTION public.fn_ca_club_game_recent_rows_union_basis(uuid,date,date,integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
