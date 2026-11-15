-- 20261115145150_every_club_reads_its_own_records_horses_included
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 14:51:50 UTC.
--
-- EVERY CLUB READS ITS OWN RECORDS, HORSES INCLUDED (owner rule 2026-11-15:
-- each club shows only the hands played through that club, and a player who
-- plays in several clubs is never excluded or moved; CLAUDE.md 10.5: a horse
-- is never filtered out of a total. Audit findings D3, D4, 2026-11-15.)
--
-- WHAT WAS WRONG (read on production 2026-11-15, read-only):
--   The statistics views below and fn_ca_club_data_fact_window read their base
--   rows through the 2026-11-02 club-split filters (20261102205742,
--   20261102215504, 20261102231943):
--     * every KINGS CLUB row of a horse was dropped;
--     * a Deep Stack Society or The Felt Society row of a horse assigned to the
--       other club was dropped, and every KINGS CLUB / Deep Stack / Felt row of
--       an assigned horse was moved to its CURRENT ca_horse_club_assignments
--       club, whatever club the hand was played through;
--     * every row of a retired horse was dropped everywhere;
--     * fn_ca_stats_home_club moved a horse's leaderboard row to its assigned
--       club, and fn_ca_stats_counts_in_club left KINGS CLUB's horses out.
--   So a club's member statistics, roster, exports, player search, win/loss,
--   top players, both leaderboards and Club Data's Chicago-basis readers showed
--   hands the club never dealt and hid hands it did. The owner's 2026-11-02
--   order to move horse statistics to the new club is superseded by the
--   2026-11-15 rule.
--
-- WHAT THIS CHANGES (report views and two helpers only; no money, ledger,
-- rake, invoice, settlement, membership or source row is written):
--   * Each view reads its base table as it is: the club of each record.
--     Same view names, columns and types; the aggregating views keep their
--     GROUP BY.
--   * fn_ca_club_data_fact_window reads ca_club_data_fact_ct by club and day.
--   * fn_ca_stats_home_club answers the club asked; fn_ca_stats_counts_in_club
--     counts everyone.
--   Rows are never moved between clubs and nobody is dropped, so a player who
--   played through two clubs appears in each with that club's hands only.
--   Applies to every club; only KINGS CLUB, Deep Stack Society and The Felt
--   Society (the three hard-coded clubs) read differently.
--
-- @live-proof: position('ca_horse_club_assignments' IN pg_get_viewdef('public.ca_stats_club_data_fact_ct'::regclass)) = 0
-- @live-proof: position('ca_horse_club_assignments' IN pg_get_viewdef('public.ca_stats_player_stats_lifetime'::regclass)) = 0
-- @live-proof: position('ca_horse_club_assignments' IN pg_get_functiondef('public.fn_ca_club_data_fact_window(uuid[],date,date)'::regprocedure)) = 0
-- @live-proof: position('ca_horse_club_assignments' IN pg_get_functiondef('public.fn_ca_stats_home_club(uuid,uuid)'::regprocedure)) = 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $preimage$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['ca_stats_club_data_fact_ct', 'ca_stats_club_member_daily_stats', 'ca_stats_club_player_daily',
    'ca_stats_club_tournament_player_daily', 'ca_stats_member_record_daily_facts', 'ca_stats_player_stats_lifetime',
    'ca_stats_player_stats_real', 'ca_stats_player_stats_snapshots_lifetime', 'ca_stats_player_stats_snapshots_real'] LOOP
    IF to_regclass('public.' || v) IS NULL
       OR position('ca_horse_club_assignments' IN pg_get_viewdef(('public.' || v)::regclass)) = 0 THEN
      RAISE EXCEPTION 'view % is not the 2026-11-02 club-split view this migration replaces', v;
    END IF;
  END LOOP;
END $preimage$;

CREATE OR REPLACE VIEW public.ca_stats_club_data_fact_ct AS
  SELECT r.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
    FROM public.ca_club_data_fact_ct r;

CREATE OR REPLACE VIEW public.ca_stats_club_member_daily_stats AS
  SELECT r.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won, r.profit,
         r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
    FROM public.club_member_daily_stats r;

CREATE OR REPLACE VIEW public.ca_stats_club_player_daily AS
  SELECT r.club_id, r.user_id, r.stat_date, r.cash_net, r.tournament_net, r.updated_at
    FROM public.ca_club_player_daily r;

CREATE OR REPLACE VIEW public.ca_stats_club_tournament_player_daily AS
  SELECT r.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
    FROM public.ca_club_tournament_player_daily r;

CREATE OR REPLACE VIEW public.ca_stats_member_record_daily_facts AS
  SELECT r.club_id, r.user_id, r.played_on, r.game_variant, r.is_mtt, r.hands, r.wins, r.vpip_hands, r.pfr_hands,
         r.tb_hands, r.faced_tb, r.folded_tb, r.cb_hands, r.cb_opps, r.fees, r.net, r.accounting_cutoff
    FROM public.member_record_daily_facts r;

CREATE OR REPLACE VIEW public.ca_stats_player_stats_lifetime AS
  SELECT g.user_id, g.club_id, sum(g.hands_played) AS hands_played, sum(g.total_winnings) AS total_winnings,
         sum(g.total_losses) AS total_losses, sum(g.total_rake) AS total_rake, sum(g.tournaments_played) AS tournaments_played,
         sum(g.tournaments_won) AS tournaments_won, (sum(g.hands_dealt))::bigint AS hands_dealt, sum(g.sum_big_blind) AS sum_big_blind
    FROM (SELECT r.user_id, r.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake,
                 r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
            FROM public.player_stats r) g
   GROUP BY g.user_id, g.club_id;

CREATE OR REPLACE VIEW public.ca_stats_player_stats_real AS
  SELECT r.id, r.user_id, r.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake, r.vpip, r.pfr,
         r.updated_at, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
    FROM public.player_stats r;

CREATE OR REPLACE VIEW public.ca_stats_player_stats_snapshots_lifetime AS
  SELECT g.user_id, g.club_id, g.snapshot_date, (sum(g.hands_played))::bigint AS hands_played,
         sum(g.total_winnings) AS total_winnings, sum(g.total_losses) AS total_losses, sum(g.total_rake) AS total_rake,
         (sum(g.tournaments_played))::bigint AS tournaments_played, (sum(g.tournaments_won))::bigint AS tournaments_won,
         (sum(g.hands_dealt))::bigint AS hands_dealt, sum(g.sum_big_blind) AS sum_big_blind
    FROM (SELECT r.user_id, r.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses, r.total_rake,
                 r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
            FROM public.player_stats_snapshots r) g
   GROUP BY g.user_id, g.club_id, g.snapshot_date;

CREATE OR REPLACE VIEW public.ca_stats_player_stats_snapshots_real AS
  SELECT r.user_id, r.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses, r.total_rake,
         r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
    FROM public.player_stats_snapshots r;

CREATE OR REPLACE FUNCTION public.fn_ca_club_data_fact_window(p_clubs uuid[], p_from date, p_through date)
RETURNS SETOF public.ca_stats_club_data_fact_ct LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT r.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
    FROM public.ca_club_data_fact_ct r
   WHERE r.club_id = ANY (p_clubs) AND r.stat_date BETWEEN p_from AND p_through;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_stats_home_club(p_user_id uuid, p_club_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT p_club_id
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_stats_counts_in_club(p_club_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT true
$function$;

COMMIT;
