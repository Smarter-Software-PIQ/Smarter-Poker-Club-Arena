-- Owner November 9: 1/2 PLO Lightning starts at ten eligible participants.
-- One funded heads-up opponent, then individual admissions around two minutes.
-- No catch-up burst, human admission cap, balance repair or new worker.
-- Uses the existing seat trigger; no lock on a live table or cash_games row.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

CREATE TABLE public.lightning_horse_admission (
  game_id uuid PRIMARY KEY,
  admitted_count bigint NOT NULL DEFAULT 0 CHECK (admitted_count >= 0),
  last_admitted_at timestamptz,
  next_admission_at timestamptz NOT NULL,
  last_player_id uuid
);
ALTER TABLE public.lightning_horse_admission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lightning_horse_admission FROM PUBLIC, anon, authenticated, service_role;

-- Private transaction component of the existing roster guard. Its clock is
-- supplied only by that original trigger, never by a client or a worker.
CREATE FUNCTION public.fn_plo_lightning_horse_admit(p_table uuid, p_player uuid, p_now timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  v_game constant uuid := 'c79d8ec2-2281-411d-b4e1-42b5610849e2';
  v_progress public.lightning_horse_admission%ROWTYPE;
  v_population integer;
  v_humans integer;
  v_rescue uuid;
BEGIN
  INSERT INTO public.lightning_horse_admission(game_id,next_admission_at)
  VALUES(v_game,p_now) ON CONFLICT(game_id) DO NOTHING;
  SELECT * INTO STRICT v_progress FROM public.lightning_horse_admission
    WHERE game_id=v_game FOR UPDATE;

  -- Funded ready bodies, pending purchases and outstanding reservations are
  -- ONE set of players. A pool anchor and its hand reservation are the same
  -- participant; conversion and same-game moves never consume another arrival.
  WITH participants AS (
    SELECT s.user_id player_id
      FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
     WHERE t.cluster_id=v_game AND NOT coalesce(t.is_deleted,false)
       AND coalesce(t.lifecycle,'')<>'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND coalesce(s.stack,0)>0
       AND NOT coalesce(s.is_sitting_out,false) AND NOT coalesce(s.leave_pending,false)
    UNION
    SELECT s.player_id FROM public.lightning_pool_session s
      JOIN public.cash_games g ON g.id=s.cluster_id AND g.cluster_epoch=s.cluster_epoch
     WHERE s.cluster_id=v_game AND s.exited_at IS NULL
       AND s.state NOT IN ('joining','eligibility_check','sit_out','disconnected','leaving','closed')
       AND public.fn_lightning_anchor_is_live_eligible(s.anchor_seat_id,v_game,s.player_id)
  ), committed AS (
    SELECT player_id FROM participants
    UNION
    -- An occupied rebuy, sit-out or disconnected chair is still held. Its
    -- original occupant may resume without a new admission; replacing it
    -- while unready would overshoot when that ordinary return completes.
    SELECT s.user_id FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
     WHERE t.cluster_id=v_game AND NOT coalesce(t.is_deleted,false)
       AND coalesce(t.lifecycle,'')<>'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND NOT coalesce(s.leave_pending,false)
    UNION
    SELECT w.user_id FROM public.table_waitlist w JOIN public.tables t ON t.id=w.table_id
     WHERE t.cluster_id=v_game AND w.status='notified'
       AND coalesce(w.hold_expires_at,w.notified_at+interval '60 seconds')>p_now
    UNION
    SELECT r.player_id FROM public.lightning_reservation r
     WHERE r.cluster_id=v_game AND r.state IN ('pending','committed') AND r.expires_at>p_now
  )
  SELECT (SELECT count(*) FROM committed WHERE player_id IS DISTINCT FROM p_player),
         (SELECT count(*) FROM participants a JOIN public.profiles p ON p.id=a.player_id
           WHERE NOT coalesce(p.is_horse,false))
    INTO v_population,v_humans;
  IF v_humans=0 OR v_population>=10 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='LIGHTNING_ADMISSION_DEMAND: no additional automated seat required';
  END IF;
  -- A feeder elsewhere must not consume the first opponent of a lone
  -- human. The original fleet can walk opening feeders before rescue tables.
  IF EXISTS(SELECT 1 FROM public.cash_games WHERE id=v_game AND cluster_mode='must_move') THEN
    SELECT t.id INTO v_rescue
      FROM public.tables t JOIN public.table_seats s ON s.table_id=t.id
      LEFT JOIN public.profiles p ON p.id=s.user_id
     WHERE t.cluster_id=v_game AND NOT coalesce(t.is_deleted,false)
       AND coalesce(t.lifecycle,'')<>'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND coalesce(s.stack,0)>0
       AND NOT coalesce(s.is_sitting_out,false) AND NOT coalesce(s.leave_pending,false)
     GROUP BY t.id HAVING count(DISTINCT s.user_id)=1 AND bool_or(NOT coalesce(p.is_horse,false))
     ORDER BY t.id LIMIT 1;
    IF v_rescue IS NOT NULL AND p_table IS DISTINCT FROM v_rescue THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='LIGHTNING_ADMISSION_DEMAND: the heads-up opponent belongs at the waiting human table';
    END IF;
  END IF;
  IF p_now<v_progress.next_admission_at THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='LIGHTNING_ADMISSION_PACED: next individual arrival is not due';
  END IF;
  -- Normal fleet ticks make this about 90-120 seconds between actual arrivals.
  -- Schedule from THIS successful admission, never from an overdue deadline.
  -- The first opponent is immediate; rollback of any buy-in rolls this back too.
  UPDATE public.lightning_horse_admission
     SET admitted_count=admitted_count+1,last_admitted_at=p_now,last_player_id=p_player,
         next_admission_at=p_now+make_interval(secs=>70+floor(random()*21)::integer)
   WHERE game_id=v_game;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $guard$
DECLARE s text:=pg_get_functiondef('public.fn_ca_horse_roster_seat_guard()'::regprocedure); n text;
BEGIN
 IF md5(s)<>'745a3bf7703a75f536b1affcbe5d63eb' THEN RAISE EXCEPTION 'Horse admission predecessor changed'; END IF;
 n:=replace(s,E'  RETURN NEW;\nEND', $admit$
  IF EXISTS(SELECT 1 FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
    WHERE t.id=NEW.table_id AND g.id='c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
      AND g.enabled AND g.lightning_enabled AND g.variant='plo4' AND g.sb=1 AND g.bb=2)
  THEN
    PERFORM public.fn_plo_lightning_horse_admit(NEW.table_id,NEW.user_id,clock_timestamp());
  END IF;
  RETURN NEW;
END$admit$);
 IF n=s THEN RAISE EXCEPTION 'Horse admission final transition absent'; END IF;
 EXECUTE n;
END $guard$;

-- The original projection and opener own the heads-up feeder minimum.
-- Other Lightning games retain their existing six-seat physical settings.
DO $physical$
DECLARE s text; n text;
BEGIN
 s:=pg_get_functiondef('public.fn_cash_apply_ruleset(uuid)'::regprocedure);
 IF md5(s)<>'267f4ead536abdc0a3bdbc6e8cb1ded6' THEN RAISE EXCEPTION 'Cash projection predecessor changed'; END IF;
 n:=replace(s,'CASE WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE t.auto_start_players END',
   'CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE t.auto_start_players END');
 n:=replace(n,'(g.template_name IN (''action'',''madness'') AND t.auto_start_players IS DISTINCT FROM 6)',
   '(g.template_name IN (''action'',''madness'') AND t.auto_start_players IS DISTINCT FROM CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 ELSE 6 END)');
 IF n=s THEN RAISE EXCEPTION 'Cash projection feeder minimum absent'; END IF;
 EXECUTE n;
 s:=pg_get_functiondef('public.fn_cash_cluster_open_table(uuid,text,integer,text,uuid)'::regprocedure);
 IF md5(s)<>'6aec784ba999fe3e4952081fd5af89ce' THEN RAISE EXCEPTION 'Cash opener predecessor changed'; END IF;
 n:=replace(s,'CASE WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE 2 END',
   'CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE 2 END');
 IF n=s THEN RAISE EXCEPTION 'Cash opener feeder minimum absent'; END IF;
 EXECUTE n;
END $physical$;

-- Configuration is authoritative and survives restarts and template projection.
-- Five-player hands remain supported; OFF at four uses the original safe
-- settlement barrier and feeder reversion. No direct mode or seat mutations.
UPDATE public.cash_games
 SET ruleset_snapshot=jsonb_set(ruleset_snapshot,'{lightning}',
       coalesce(ruleset_snapshot->'lightning','{}'::jsonb)||
       jsonb_build_object('always_on',false,'on_threshold',10,'off_threshold',4)),
     updated_at=now()
 WHERE id='c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
   AND variant='plo4' AND sb=1 AND bb=2 AND lightning_enabled;
DO $scope$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cash_games WHERE id='c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
   AND ruleset_snapshot#>>'{lightning,on_threshold}'='10'
   AND ruleset_snapshot#>>'{lightning,always_on}'='false') THEN
   RAISE EXCEPTION 'Assigned 1/2 PLO Lightning game not found';
 END IF;
END $scope$;
SELECT public.fn_cash_apply_ruleset('c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid);
COMMIT;
