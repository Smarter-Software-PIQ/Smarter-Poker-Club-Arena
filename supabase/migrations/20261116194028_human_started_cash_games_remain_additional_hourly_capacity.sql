-- Owner November 16: a human starting table 14 may keep it above a cap of 13.
-- Reserved by scripts/new-migration.mjs. Requires 20261116153902 first.
-- Permanent first-seat origin, original transaction and financial owners.
-- No tournament, hot-table DDL, financial replay or scheduled repair change.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $preimage$
DECLARE f record;
BEGIN
 FOR f IN SELECT * FROM (VALUES
 ('fn_cash_hourly_table_admit(uuid,uuid)','d8b3969b58b80a9e27f1276048cac94f'),
 ('fn_cash_hourly_table_excess(uuid)','dafb6c41b4f95d04c45ac3675555e116'),
 ('fn_cash_hourly_table_admissions()','61c889f04d48f8002e2aeedc6abd12bc'),
 ('fn_cash_hourly_table_drain_candidate()','69dddcd6009db5bdbbe9692142ce1de6')
 ) expected(signature,digest) LOOP
  IF to_regprocedure('public.'||f.signature) IS NULL OR
   md5(pg_get_functiondef(to_regprocedure('public.'||f.signature))) IS DISTINCT FROM f.digest THEN
   RAISE EXCEPTION 'cash_hourly_human_expansion_predecessor_changed:%',f.signature;
  END IF;
 END LOOP;
END $preimage$;

CREATE TABLE public.cash_hourly_table_origins(
 table_id uuid PRIMARY KEY,human_started boolean NOT NULL);
ALTER TABLE public.cash_hourly_table_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_hourly_table_origins FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_cash_hourly_table_capacity_census()
RETURNS TABLE(table_id uuid,occupied bigint,humans bigint,opened_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 SELECT c.* FROM public.fn_cash_hourly_table_census() c
 LEFT JOIN public.cash_hourly_table_origins o USING(table_id)
 WHERE NOT(coalesce(o.human_started,false) AND c.humans>0);
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_excess(p_table_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_capacity_census()),
 budget AS(SELECT greatest(0,r.table_cap-(SELECT count(*) FROM floor WHERE humans>0)) n
 FROM public.fn_cash_hourly_table_range() r),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n
 FROM floor WHERE humans=0)
 SELECT EXISTS(SELECT 1 FROM ranked,budget WHERE table_id=p_table_id AND ranked.n>budget.n);
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_drain_candidate()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_capacity_census()),
 budget AS(SELECT greatest(0,r.table_cap-(SELECT count(*) FROM floor WHERE humans>0)) n
 FROM public.fn_cash_hourly_table_range() r),
 ranked AS(SELECT table_id,opened_at,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n
 FROM floor WHERE humans=0)
 SELECT table_id FROM ranked,budget
 WHERE ranked.n>budget.n AND public.fn_cash_hourly_table_enabled()
 AND NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
 WHERE scope='floor' AND next_close_at>clock_timestamp())
 ORDER BY opened_at DESC NULLS FIRST,table_id DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_admit(p_table_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE t public.tables%ROWTYPE; n integer; cap integer; human boolean; empty boolean;
 funded_move boolean; releases_source boolean; neutral_swap boolean; policy_enabled boolean;
 now_at timestamptz:=clock_timestamp(); pace public.cash_hourly_table_starts%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND OR t.tournament_id IS NOT NULL OR coalesce(t.is_spins,false) THEN RETURN; END IF;
 policy_enabled:=public.fn_cash_hourly_table_enabled();
 -- A first human seat and boundary close share this lock. Existing stack,
 -- settlement and departure updates bypass this function in the caller.
 SELECT * INTO t FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
 IF policy_enabled AND (t.status='closed' OR t.lifecycle='closed') THEN
  RAISE EXCEPTION 'cash_hourly_table_closed' USING ERRCODE='42501'; END IF;
 -- The original atomic swap temporarily clears BOTH old chairs first. Its
 -- reciprocal, ready, unexpired plans prove a headcount-neutral exchange;
 -- never mistake that temporary empty state for a newly started game.
 SELECT coalesce(public.fn_caller_is_engine(),false)
 AND current_setting('app.cash_seat_move',true)='on' AND t.cluster_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.cash_seat_moves m JOIN public.cash_seat_moves partner
 ON partner.id=m.swap_move_id AND partner.swap_move_id=m.id
 WHERE m.player_id=p_user_id AND m.to_table_id=t.id AND m.game_id=t.cluster_id
 AND partner.game_id=m.game_id AND partner.from_table_id=m.to_table_id
 AND partner.to_table_id=m.from_table_id AND partner.player_id<>m.player_id
 AND m.state='pending' AND partner.state='pending'
 AND m.ready_at IS NOT NULL AND partner.ready_at IS NOT NULL
 AND m.expires_at>now_at AND partner.expires_at>now_at) INTO neutral_swap;
 IF neutral_swap THEN RETURN; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)
 INTO empty;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse) THEN
  IF empty AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse IS FALSE) THEN
   INSERT INTO public.cash_hourly_table_origins(table_id,human_started) VALUES(p_table_id,true)
   ON CONFLICT(table_id) DO UPDATE SET human_started=true;
  END IF;
  RETURN;
 END IF;
 IF empty THEN
  INSERT INTO public.cash_hourly_table_origins(table_id,human_started) VALUES(p_table_id,false)
  ON CONFLICT(table_id) DO UPDATE SET human_started=false;
 END IF;
 -- Origin follows actual first seating across cold starts/older rollbacks;
 -- capacity and arrival restrictions still remain inactive for that leader.
 IF NOT policy_enabled THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM public.table_seats s LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse IS DISTINCT FROM true) INTO human;
 -- One-way funded moves into established games keep their ordinary behavior.
 -- An assembling game still admits one arrival per window, whoever funds it.
 -- The original one-way executor inserts before releasing its source chair.
 SELECT coalesce(public.fn_caller_is_engine(),false)
 AND current_setting('app.cash_seat_move',true)='on' AND t.cluster_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id
 AND src.cluster_id=t.cluster_id AND src.tournament_id IS NULL AND NOT coalesce(src.is_spins,false))
 INTO funded_move;
 IF funded_move AND NOT empty
 AND NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_starts WHERE table_id=t.id)
 AND EXISTS(SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id=s.user_id
 WHERE s.table_id=t.id AND s.left_at IS NULL AND p.is_horse) THEN RETURN; END IF;
 SELECT coalesce(funded_move,false) AND EXISTS(
 SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id AND src.cluster_id=t.cluster_id
 AND NOT EXISTS(SELECT 1 FROM public.table_seats other WHERE other.table_id=src.id
 AND other.left_at IS NULL AND other.id<>s.id)) INTO releases_source;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
  RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
 IF NOT human THEN
  SELECT table_cap INTO STRICT cap FROM public.fn_cash_hourly_table_range();
  SELECT count(*) INTO n FROM public.fn_cash_hourly_table_capacity_census();
  IF (empty AND n-CASE WHEN releases_source THEN 1 ELSE 0 END>=cap) OR (NOT empty AND public.fn_cash_hourly_table_excess(p_table_id)) THEN
   RAISE EXCEPTION 'cash_hourly_table_cap_reached:%',cap USING ERRCODE='42501'; END IF;
  IF empty THEN
   IF EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_open_at>now_at) THEN
    RAISE EXCEPTION 'cash_hourly_table_start_paced' USING ERRCODE='42501'; END IF;
   UPDATE public.cash_hourly_table_pacing SET next_open_at=now_at+public.fn_cash_hourly_table_delay(p_table_id)
    WHERE scope='floor';
  END IF;
 END IF;
 -- Every NEW game builds its Horse seats individually over 2-4 minute gaps.
 -- A human who starts an empty table grants only THAT table the cap exception.
 -- Once established, ordinary replenishment keeps its existing behavior.
 IF empty OR NOT EXISTS(SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id=s.user_id
                        WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse) THEN
  INSERT INTO public.cash_hourly_table_starts(table_id,started_at,next_horse_at)
  VALUES(p_table_id,now_at,'-infinity') ON CONFLICT(table_id) DO NOTHING;
 END IF;
 SELECT * INTO pace FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
 IF FOUND THEN
  IF pace.next_horse_at>now_at THEN
   RAISE EXCEPTION 'cash_hourly_horse_arrival_paced' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)+1>=t.max_players THEN
   DELETE FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
  ELSE
   UPDATE public.cash_hourly_table_starts SET next_horse_at=now_at+public.fn_cash_hourly_table_delay(p_table_id)
    WHERE table_id=p_table_id;
  END IF;
 END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_admissions()
RETURNS TABLE(table_id uuid,allowed boolean,max_horses integer,starts_game boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 counted AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_capacity_census()),
 budget AS(SELECT table_cap cap,(SELECT count(*) FROM counted) occupied,
 greatest(0,table_cap-(SELECT count(*) FROM counted WHERE humans>0)) retained
 FROM public.fn_cash_hourly_table_range()),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n FROM floor WHERE humans=0)
 SELECT t.id,
 (NOT public.fn_cash_hourly_table_enabled() OR ((coalesce(f.humans,0)>0 OR CASE WHEN f.table_id IS NULL THEN b.occupied<b.cap
  ELSE coalesce(r.n,0)<=b.retained END)
 AND (f.table_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
  WHERE scope='floor' AND next_open_at>clock_timestamp()))
 AND (p.table_id IS NULL OR p.next_horse_at<=clock_timestamp()))),
 CASE WHEN p.table_id IS NOT NULL OR f.table_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.table_seats s JOIN public.profiles hp ON hp.id=s.user_id
  WHERE s.table_id=t.id AND s.left_at IS NULL AND hp.is_horse) THEN 1 ELSE t.max_players END,
 f.table_id IS NULL
 FROM public.tables t CROSS JOIN budget b LEFT JOIN floor f ON f.table_id=t.id
 LEFT JOIN ranked r ON r.table_id=t.id LEFT JOIN public.cash_hourly_table_starts p ON p.table_id=t.id
 WHERE t.tournament_id IS NULL AND NOT coalesce(t.is_spins,false)
 AND NOT coalesce(t.is_template,false) AND NOT coalesce(t.is_deleted,false)
 AND t.status IN('waiting','running') AND coalesce(t.lifecycle,'') NOT IN('closed','breaking');
$fn$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_table_capacity_census(),
 public.fn_cash_hourly_table_excess(uuid),public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_admit(uuid,uuid),public.fn_cash_hourly_table_admissions()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_table_capacity_census(),
 public.fn_cash_hourly_table_excess(uuid),public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_admit(uuid,uuid),public.fn_cash_hourly_table_admissions() TO service_role;
COMMIT;
