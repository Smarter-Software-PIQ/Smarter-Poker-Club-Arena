-- 20261102215504_horses_fully_leave_old_clubs_and_take_their_stats
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 21:55:04 UTC.
--
-- Owner order (Dan, 2026-11-02 15:46 CT): "MAKE SURE ANY AND ALL HORSES ARE
-- FULLY REMOVED, THAT ALL OF THEIR PLAYER STATS ARE REMOVED AND TRANSFERED TO
-- THERE NEW CLUB".
--
-- 1. Membership. The split's settling stage no longer waits for a horse's
--    tournament entries in a club it left: the membership departs now, with
--    records retained. A prize or bounty those entries still pay is credited
--    to the retained record exactly as the payout path already allows for a
--    departed member (fn_guard_membership_lifecycle_write lets the engine move
--    chip_balance only), and fn_ca_horse_club_split_late_claims returns it to
--    that club's bank once every event the record is in has finished: one
--    late claim per record, through the same Club Bank leg, so it is final and
--    can never be paid twice. Entries not yet started were unregistered
--    through fn_ca_unregister_tournament_player_exact before this change.
-- 2. Statistics. The attribution views (20261102205742) now move every
--    canonical horse's history out of every split club it does not belong to
--    (Kings Club, Deep Stack Society, The Felt Society) into its assigned
--    club, and still drop any other horse's Kings Club row. Period
--    leaderboards read the union's raw rows again: attribution there is by
--    each player's home club, which is now the horse's assigned club. No
--    rollup, fact or ledger row is rewritten.
-- @live-proof: position('late_wallet_claim' IN pg_get_functiondef('public.fn_ca_horse_split_wallet_leg(uuid,text,uuid,uuid,numeric)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

INSERT INTO public.ca_money_rpc_registry(proname, status, notes) VALUES
 ('fn_ca_horse_club_split_late_claims', 'approved',
  'Horse club split (Dan 2026-11-02 15:46 CT): one final late Club Bank claim per departed split record after all its events finish, through fn_ca_horse_split_wallet_leg; trusted callers only.')
ON CONFLICT (proname) DO NOTHING;

ALTER TABLE public.ca_horse_club_split_receipts DROP CONSTRAINT ca_horse_club_split_receipts_kind_check;
ALTER TABLE public.ca_horse_club_split_receipts ADD CONSTRAINT ca_horse_club_split_receipts_kind_check
  CHECK (kind IN ('player_wallet_claim','settle_wallet_claim','late_wallet_claim','agent_wallet_claim','departed',
                  'deferred','joined','downline_released','mint','fund_10000','kings_display'));

DO $migration$
DECLARE
  v_edits text[][] := ARRAY[
    ['public.fn_ca_horse_split_wallet_leg(uuid,text,uuid,uuid,numeric)',
     $o$IF p_kind IN ('player_wallet_claim', 'settle_wallet_claim') THEN$o$,
     $n$IF p_kind IN ('player_wallet_claim', 'settle_wallet_claim', 'late_wallet_claim') THEN$n$],
    ['public.fn_ca_horse_club_split_execute(uuid,integer)',
     E'      CONTINUE WHEN EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id\n                         LEFT JOIN public.clubs h ON h.id = t.club_id\n                        WHERE tp.user_id = r.horse_id AND tp.club_id = r.club_id\n                          AND lower(coalesce(tp.status::text,\'\')) IN (\'registered\',\'playing\')\n                          AND upper(coalesce(t.status::text,\'\')) NOT IN (\'COMPLETED\',\'CANCELLED\')\n                          AND NOT coalesce(h.is_platform, false));\n',
     E'      -- Departs now (Dan 2026-11-02 15:46 CT); a later prize on the retained\n      -- record returns through fn_ca_horse_club_split_late_claims.\n'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     'JOIN public.ca_stats_player_stats_real ps ON ps.club_id = sc.club_id',
     'JOIN public.player_stats ps ON ps.club_id = sc.club_id'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'LEFT JOIN public.ca_stats_player_stats_snapshots_real b\n        ON b.user_id=ps.user_id AND b.club_id=ps.club_id AND b.snapshot_date=sc.baseline',
     E'LEFT JOIN public.player_stats_snapshots b\n        ON b.user_id=ps.user_id AND b.club_id=ps.club_id AND b.snapshot_date=sc.baseline'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'LEFT JOIN public.ca_stats_player_stats_snapshots_real pe\n        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=sc.prev_end',
     E'LEFT JOIN public.player_stats_snapshots pe\n        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=sc.prev_end'],
    ['public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)',
     E'LEFT JOIN public.ca_stats_player_stats_snapshots_real pv\n        ON pv.user_id=ps.user_id AND pv.club_id=ps.club_id AND pv.snapshot_date=sc.baseline',
     E'LEFT JOIN public.player_stats_snapshots pv\n        ON pv.user_id=ps.user_id AND pv.club_id=ps.club_id AND pv.snapshot_date=sc.baseline']
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
      RAISE EXCEPTION 'horses fully leave: % no longer contains %', v_fn, left(v_edits[i][2], 80);
    END IF;
    v_def := replace(v_def, v_edits[i][2], v_edits[i][3]);
  END LOOP;
  EXECUTE v_def;
END;
$migration$;

CREATE OR REPLACE VIEW public.ca_stats_club_member_daily_stats AS
SELECT r.club_id, r.table_id, r.user_id, r.stat_date, r.hands_played, r.hands_won, r.total_won, r.profit, r.biggest_pot_won, r.biggest_pot, r.topup_total, r.updated_at, r.hands_attributed
  FROM public.club_member_daily_stats r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))
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
UNION ALL
SELECT a.club_id, r.tournament_id, r.user_id, r.stat_date, r.updated_at
  FROM public.ca_club_tournament_player_daily r
  JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
 WHERE r.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid);

CREATE OR REPLACE VIEW public.ca_stats_player_stats_real AS
SELECT r.* FROM public.player_stats r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid));

CREATE OR REPLACE VIEW public.ca_stats_player_stats_snapshots_real AS
SELECT r.* FROM public.player_stats_snapshots r
 WHERE (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE))
   AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))
   AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments x WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid));

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

-- A prize or bounty credited to a departed split record after it departed is
-- returned to that club's bank once every event the record is in has
-- finished. One claim per record (receipt and op id are unique), so it is
-- final and never pays twice; a record still in a running event is left
-- for a later call.
CREATE FUNCTION public.fn_ca_horse_club_split_late_claims(p_operation uuid, p_max_rows integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  r record;
  v_n integer := 0;
  v_amount numeric := 0;
  v_waiting integer;
BEGIN
  IF public.fn_caller_is_engine() IS NOT TRUE THEN
    RAISE EXCEPTION 'horse_split_late_claims_trusted_callers_only' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance, 0) AS wallet
      FROM public.ca_horse_club_split_receipts d
      JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
     WHERE d.operation_id = p_operation AND d.kind = 'departed'
       AND cm.membership_lifecycle_status = 'departed'
       AND coalesce(cm.chip_balance, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts l
                        WHERE l.operation_id = p_operation AND l.horse_id = d.horse_id
                          AND l.club_id = d.club_id AND l.kind = 'late_wallet_claim')
       AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                        WHERE tp.user_id = d.horse_id AND tp.club_id = d.club_id
                          AND upper(coalesce(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED'))
     ORDER BY cm.club_id, cm.user_id
     LIMIT greatest(coalesce(p_max_rows, 200), 1)
  LOOP
    PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'late_wallet_claim', r.club_id, r.horse_id, r.wallet);
    v_n := v_n + 1;
    v_amount := v_amount + r.wallet;
  END LOOP;
  SELECT count(*) INTO v_waiting
    FROM public.ca_horse_club_split_receipts d
    JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
   WHERE d.operation_id = p_operation AND d.kind = 'departed'
     AND cm.membership_lifecycle_status = 'departed'
     AND EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                  WHERE tp.user_id = d.horse_id AND tp.club_id = d.club_id
                    AND upper(coalesce(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED'));
  RETURN jsonb_build_object('claimed', v_n, 'amount', v_amount, 'records_in_running_events', v_waiting);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_late_claims(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

DO $verify$
BEGIN
  IF position('CONTINUE WHEN EXISTS (SELECT 1 FROM public.tournament_players' IN
       pg_get_functiondef('public.fn_ca_horse_club_split_execute(uuid,integer)'::regprocedure)) > 0
     OR position('late_wallet_claim' IN
       pg_get_functiondef('public.fn_ca_horse_split_wallet_leg(uuid,text,uuid,uuid,numeric)'::regprocedure)) = 0
     OR position('ca_stats_player_stats_real ps ON ps.club_id = sc.club_id' IN
       pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'horses fully leave: an edit did not land';
  END IF;
END;
$verify$;

COMMIT;
