-- 20261102231943_retired_horses_and_the_lightning_pilot_retire
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 23:19:43 UTC.
--
-- Owner order (Dan, 2026-11-02 17:17 CT): "RETIRE THE HORSES AND RETIRE THE
-- LIGHNING PILOT", answering the two items left after the horse club split.
--
-- 1. Retired horses. The 62 horses outside the canonical 1,000 were already
--    retired in ca_horse_fleet_register, with every membership departed and
--    no chips, seat or open entry. Their history now leaves every club's
--    player statistics as well: the attribution views (20261102205742,
--    20261102215504) drop any row of a horse whose fleet record is retired.
-- 2. Lightning Internal Pilot. The club has been retired since 2026-10-31
--    (fn_retire_settled_club): every table closed, no open event, no chips in
--    any bank, wallet or agent wallet. Its 144 remaining horse memberships
--    depart now with records retained. Those rows carry is_bot, and the
--    club_members_bot_house_only CHECK refuses any update to an automated row
--    outside a house board, so the board function admits the pilot for this
--    one transaction only and is restored byte for byte (md5 asserted)
--    before COMMIT. Human records (owner, KingFish) stay as the retired
--    club's records; the client already hides retired clubs.
-- No chip, rollup, fact or ledger row changes.
-- @live-proof: (SELECT count(*) = 0 FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse WHERE cm.club_id = 'e14bc9f7-736d-425f-8f2c-e78305ebac1d' AND cm.membership_lifecycle_status = 'active')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE VIEW public.ca_stats_club_member_daily_stats AS
SELECT r.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won, r.profit, r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
  FROM public.club_member_daily_stats r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
UNION ALL
SELECT a.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won, r.profit, r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
  FROM public.club_member_daily_stats r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_club_player_daily AS
SELECT r.club_id, r.user_id, r.stat_date, r.cash_net, r.tournament_net, r.updated_at
  FROM public.ca_club_player_daily r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
UNION ALL
SELECT a.club_id, r.user_id, r.stat_date, r.cash_net, r.tournament_net, r.updated_at
  FROM public.ca_club_player_daily r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_member_record_daily_facts AS
SELECT r.club_id, r.user_id, r.played_on, r.game_variant, r.is_mtt, r.hands, r.wins, r.vpip_hands, r.pfr_hands, r.tb_hands, r.faced_tb, r.folded_tb, r.cb_hands, r.cb_opps, r.fees, r.net, r.accounting_cutoff
  FROM public.member_record_daily_facts r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
UNION ALL
SELECT a.club_id, r.user_id, r.played_on, r.game_variant, r.is_mtt, r.hands, r.wins, r.vpip_hands, r.pfr_hands, r.tb_hands, r.faced_tb, r.folded_tb, r.cb_hands, r.cb_opps, r.fees, r.net, CASE WHEN r.accounting_cutoff IS NOT DISTINCT FROM public.fn_ca_launch_accounting_cutoff('club', r.club_id) THEN public.fn_ca_launch_accounting_cutoff('club', a.club_id) ELSE '-infinity'::timestamptz END
  FROM public.member_record_daily_facts r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_club_data_fact_ct AS
SELECT r.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
  FROM public.ca_club_data_fact_ct r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
UNION ALL
SELECT a.club_id, r.stat_date, r.kind, r.game_id, r.user_id, r.fee, r.buyins, r.cashouts, r.winnings, r.last_at, r.src
  FROM public.ca_club_data_fact_ct r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_club_tournament_player_daily AS
SELECT r.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
  FROM public.ca_club_tournament_player_daily r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
UNION ALL
SELECT a.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
  FROM public.ca_club_tournament_player_daily r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_player_stats_real AS
SELECT r.* FROM public.player_stats r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL);

CREATE OR REPLACE VIEW public.ca_stats_player_stats_snapshots_real AS
SELECT r.* FROM public.player_stats_snapshots r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL);

CREATE OR REPLACE VIEW public.ca_stats_player_stats_lifetime AS
SELECT g.user_id, g.club_id,
       sum(g.hands_played)::bigint AS hands_played,
       sum(g.total_winnings) AS total_winnings,
       sum(g.total_losses) AS total_losses,
       sum(g.total_rake) AS total_rake,
       sum(g.tournaments_played)::bigint AS tournaments_played,
       sum(g.tournaments_won)::bigint AS tournaments_won,
       sum(g.hands_dealt)::bigint AS hands_dealt,
       sum(g.sum_big_blind) AS sum_big_blind
  FROM (
    SELECT r.user_id, r.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats r
     WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
    UNION ALL
    SELECT r.user_id, a.club_id, r.hands_played, r.total_winnings, r.total_losses, r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats r
      JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
     WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid)
  ) g
 GROUP BY g.user_id, g.club_id;

CREATE OR REPLACE VIEW public.ca_stats_player_stats_snapshots_lifetime AS
SELECT g.user_id, g.club_id, g.snapshot_date,
       sum(g.hands_played)::bigint AS hands_played,
       sum(g.total_winnings) AS total_winnings,
       sum(g.total_losses) AS total_losses,
       sum(g.total_rake) AS total_rake,
       sum(g.tournaments_played)::bigint AS tournaments_played,
       sum(g.tournaments_won)::bigint AS tournaments_won,
       sum(g.hands_dealt)::bigint AS hands_dealt,
       sum(g.sum_big_blind) AS sum_big_blind
  FROM (
    SELECT r.user_id, r.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses, r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats_snapshots r
     WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
   AND NOT EXISTS (SELECT 1 FROM public.ca_horse_fleet_register rr WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL)
    UNION ALL
    SELECT r.user_id, a.club_id, r.snapshot_date, r.hands_played, r.total_winnings, r.total_losses, r.total_rake, r.tournaments_played, r.tournaments_won, r.hands_dealt, r.sum_big_blind
      FROM public.player_stats_snapshots r
      JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
     WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid)
  ) g
 GROUP BY g.user_id, g.club_id, g.snapshot_date;

-- Read only by the SECURITY DEFINER readers (owner postgres).
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

DO $pilot$
DECLARE
  c_pilot constant uuid := 'e14bc9f7-736d-425f-8f2c-e78305ebac1d';
  v_orig text := pg_get_functiondef('public.fn_ca_house_board_allows_automation(uuid)'::regprocedure);
  v_anchor constant text := 'OR p_club_id = ANY (ARRAY[';
  v_n integer;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_house_board_allows_automation(uuid)'::regprocedure)
     <> 'e9f2cebe69872f747dd84a933746f02e' THEN
    RAISE EXCEPTION 'pilot retirement: house board function changed';
  END IF;
  IF (SELECT lifecycle_status FROM public.clubs WHERE id = c_pilot) IS DISTINCT FROM 'retired' THEN
    RAISE EXCEPTION 'pilot retirement: the pilot club is not retired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id = c_pilot
              AND (coalesce(cm.chip_balance,0) <> 0 OR coalesce(cm.held_chips,0) <> 0
                   OR coalesce(cm.promo_balance,0) <> 0 OR coalesce(cm.locked_chips,0) <> 0))
     OR EXISTS (SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id = s.table_id
                 WHERE t.club_id = c_pilot AND s.left_at IS NULL) THEN
    RAISE EXCEPTION 'pilot retirement: the pilot still holds value or a seat';
  END IF;
  IF position(v_anchor IN v_orig) = 0 THEN
    RAISE EXCEPTION 'pilot retirement: house board anchor missing';
  END IF;

  -- The pilot is admitted for this transaction only; v_orig is restored below.
  EXECUTE replace(v_orig, v_anchor, format('OR p_club_id = %L::uuid ', c_pilot) || v_anchor);
  PERFORM set_config('app.club_retirement_maintenance', 'on', true);
  PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
  UPDATE public.club_members cm
     SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
         departed_at = clock_timestamp(), departed_by = NULL,
         departure_reason = 'Lightning Internal Pilot Retired (Dan, 2026-11-02)',
         updated_at = clock_timestamp()
   WHERE cm.club_id = c_pilot AND cm.membership_lifecycle_status = 'active'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cm.user_id AND p.is_horse IS TRUE);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.club_membership_lifecycle_write', '', true);
  PERFORM set_config('app.club_retirement_maintenance', '', true);
  EXECUTE v_orig;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_house_board_allows_automation(uuid)'::regprocedure)
     <> 'e9f2cebe69872f747dd84a933746f02e' THEN
    RAISE EXCEPTION 'pilot retirement: house board function not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
              WHERE cm.club_id = c_pilot AND cm.membership_lifecycle_status = 'active') THEN
    RAISE EXCEPTION 'pilot retirement: a horse membership is still active';
  END IF;
  RAISE NOTICE 'pilot retirement: % horse memberships departed', v_n;
END;
$pilot$;

COMMIT;
