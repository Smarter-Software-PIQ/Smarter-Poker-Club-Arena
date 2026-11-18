-- 20261111214248_every_lightning_game_joins_horses_one_at_a_time.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner, Dan, 2026-11-11):
--
-- "PLO5 1/2 Lightning, 0 players. I sat down and within about a minute it was
-- a full game with enough to start Lightning." Production record, game
-- f67a1436 (PLO5 1.00/2.00 Lightning Games): the one person entered the pool
-- at 15:05:43Z and 35 Horses were seated between 15:06:02Z and 15:06:33Z.
-- The gradual one-at-a-time admission (20261109141301: one heads-up opponent
-- at once, then one arrival 70 to 90 seconds after the previous one) was
-- written into the roster seat guard for ONE game, c79d8ec2 (PLO4 1/2), so
-- every other Lightning game was filled in a single fleet pass.
--
-- Second root cause on the same game: the canonical creator writes
-- lightning.always_on = true, and the drive never reverts such a game, so an
-- EMPTY Lightning game stays in Lightning mode forever. Its cash tick stands
-- down (last_tick_at was 2026-10-24, the lobby printed "Tick 442h Ago"), its
-- six anchor tables stay listed with nobody at them, a person cannot simply
-- take a seat (the game offers only the pool door) and a lone pool player
-- waits for a hand that cannot form. The owner rule (2026-11-05) is the
-- opposite: "they are feeder games until enough players are playing, then
-- they turn to lightning games ONLY WHEN THERE IS ENOUGH PLAYERS." c79d8ec2
-- was already moved to always_on = false; this does the same for every
-- Lightning game and for the creator, and gives the must-move half of every
-- Lightning game the heads-up feeder minimum c79d8ec2 already has (2), so a
-- person who sits down plays at once while the paced arrivals come in.
--
-- THE PACED RULE, for every enabled Lightning game other than c79d8ec2,
-- whose own owner-specific route (ON10 demand cap and continuation) is left
-- byte for byte as it is:
--   * one Horse buy-in at a time per game, never two inside the spacing;
--   * the spacing is 70 to 90 seconds (the same schedule as c79d8ec2),
--     counted from the last SUCCESSFUL admission, never an overdue catch-up;
--   * a lone person's heads-up opponent is not consumed by another table;
--   * once the game holds at least one full Lightning start (on_threshold)
--     the spacing is divided by the number of whole starts it holds, so an
--     established pool keeps its normal replacement rate while each start's
--     worth of players still arrives one at a time.
-- People are never paced or capped; only Horse seat inserts reach this guard.
-- A refused admission raises P0001 inside the buy-in, which rolls the debit,
-- the seat and the progress row back together (the original contract).
-- No timer, worker, sweep or repair loop is added.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION public.fn_lightning_horse_admit_paced(p_table uuid, p_player uuid, p_now timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_game uuid;
  v_mode text;
  v_on integer;
  v_progress public.lightning_horse_admission%ROWTYPE;
  v_population integer;
  v_rescue uuid;
  v_streams integer;
BEGIN
  SELECT g.id, g.cluster_mode,
         greatest(2, coalesce(nullif(g.ruleset_snapshot#>>'{lightning,on_threshold}', '')::integer, 5))
    INTO v_game, v_mode, v_on
    FROM public.tables t JOIN public.cash_games g ON g.id = t.cluster_id
   WHERE t.id = p_table AND g.enabled AND g.lightning_enabled;
  IF v_game IS NULL THEN RETURN; END IF;

  INSERT INTO public.lightning_horse_admission(game_id, next_admission_at)
  VALUES (v_game, p_now) ON CONFLICT (game_id) DO NOTHING;
  SELECT * INTO STRICT v_progress FROM public.lightning_horse_admission
   WHERE game_id = v_game FOR UPDATE;

  -- The same participant set as the c79d8ec2 route: funded ready seats, live
  -- pool sessions, held chairs, notified waitlist holds and outstanding hand
  -- reservations, each player once, the arriving Horse excluded.
  WITH committed AS (
    SELECT s.user_id AS player_id
      FROM public.table_seats s JOIN public.tables t ON t.id = s.table_id
     WHERE t.cluster_id = v_game AND NOT coalesce(t.is_deleted, false)
       AND coalesce(t.lifecycle, '') <> 'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND NOT coalesce(s.leave_pending, false)
    UNION
    SELECT s.player_id FROM public.lightning_pool_session s
      JOIN public.cash_games g ON g.id = s.cluster_id AND g.cluster_epoch = s.cluster_epoch
     WHERE s.cluster_id = v_game AND s.exited_at IS NULL
       AND s.state NOT IN ('joining', 'eligibility_check', 'sit_out', 'disconnected', 'leaving', 'closed')
    UNION
    SELECT w.user_id FROM public.table_waitlist w JOIN public.tables t ON t.id = w.table_id
     WHERE t.cluster_id = v_game AND w.status = 'notified'
       AND coalesce(w.hold_expires_at, w.notified_at + interval '60 seconds') > p_now
    UNION
    SELECT r.player_id FROM public.lightning_reservation r
     WHERE r.cluster_id = v_game AND r.state IN ('pending', 'committed') AND r.expires_at > p_now
  )
  SELECT count(*) INTO v_population FROM committed WHERE player_id IS DISTINCT FROM p_player;

  -- A lone person's first opponent belongs at that person's table.
  IF v_mode = 'must_move' THEN
    SELECT t.id INTO v_rescue
      FROM public.tables t JOIN public.table_seats s ON s.table_id = t.id
      LEFT JOIN public.profiles p ON p.id = s.user_id
     WHERE t.cluster_id = v_game AND NOT coalesce(t.is_deleted, false)
       AND coalesce(t.lifecycle, '') <> 'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND coalesce(s.stack, 0) > 0
       AND NOT coalesce(s.is_sitting_out, false) AND NOT coalesce(s.leave_pending, false)
     GROUP BY t.id HAVING count(DISTINCT s.user_id) = 1 AND bool_or(NOT coalesce(p.is_horse, false))
     ORDER BY t.id LIMIT 1;
    IF v_rescue IS NOT NULL AND p_table IS DISTINCT FROM v_rescue THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LIGHTNING_ADMISSION_DEMAND: the heads-up opponent belongs at the waiting human table';
    END IF;
  END IF;

  IF p_now < v_progress.next_admission_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'LIGHTNING_ADMISSION_PACED: next individual arrival is not due';
  END IF;

  v_streams := greatest(1, v_population / v_on);
  UPDATE public.lightning_horse_admission
     SET admitted_count = admitted_count + 1, last_admitted_at = p_now, last_player_id = p_player,
         next_admission_at = p_now + make_interval(secs => (70 + floor(random() * 21)) / v_streams)
   WHERE game_id = v_game;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_horse_admit_paced(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- The original roster seat guard calls it for every other Lightning game.
DO $guard$
DECLARE s text := pg_get_functiondef('public.fn_ca_horse_roster_seat_guard()'::regprocedure); n text;
BEGIN
  IF md5(s) <> 'de802845406367520558e78abbca1bef' THEN
    RAISE EXCEPTION 'Horse roster seat guard predecessor changed';
  END IF;
  n := replace(s,
$old$    PERFORM public.fn_plo_lightning_horse_admit(NEW.table_id,NEW.user_id,clock_timestamp());
  END IF;
  RETURN NEW;$old$,
$new$    PERFORM public.fn_plo_lightning_horse_admit(NEW.table_id,NEW.user_id,clock_timestamp());
  ELSIF EXISTS(SELECT 1 FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
    WHERE t.id=NEW.table_id AND g.enabled AND g.lightning_enabled)
  THEN
    -- Every other Lightning game: one Horse at a time (20261111214248).
    PERFORM public.fn_lightning_horse_admit_paced(NEW.table_id,NEW.user_id,clock_timestamp());
  END IF;
  RETURN NEW;$new$);
  IF n = s THEN RAISE EXCEPTION 'Horse roster seat guard paced branch anchor absent'; END IF;
  EXECUTE n;
END $guard$;

-- The must-move half of a Lightning game deals heads-up, as c79d8ec2 does.
DO $physical$
DECLARE s text; n text;
BEGIN
  s := pg_get_functiondef('public.fn_cash_apply_ruleset(uuid)'::regprocedure);
  IF md5(s) <> '766d39e686bbebb6232887e5f8c43780' THEN RAISE EXCEPTION 'Cash projection predecessor changed'; END IF;
  n := replace(s,
    'CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE t.auto_start_players END',
    'CASE WHEN g.lightning_enabled THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE t.auto_start_players END');
  n := replace(n,
    'CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 ELSE 6 END',
    'CASE WHEN g.lightning_enabled THEN 2 ELSE 6 END');
  IF n = s OR position('c79d8ec2' in n) > 0 THEN RAISE EXCEPTION 'Cash projection feeder minimum anchor absent'; END IF;
  EXECUTE n;

  s := pg_get_functiondef('public.fn_cash_cluster_open_table(uuid,text,integer,text,uuid)'::regprocedure);
  IF md5(s) <> 'da2ad50fe8c8a0852ab60b21c1117615' THEN RAISE EXCEPTION 'Cash opener predecessor changed'; END IF;
  n := replace(s,
    'CASE WHEN g.id=''c79d8ec2-2281-411d-b4e1-42b5610849e2''::uuid THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE 2 END',
    'CASE WHEN g.lightning_enabled THEN 2 WHEN g.template_name IN (''action'',''madness'') THEN 6 ELSE 2 END');
  IF n = s OR position('c79d8ec2' in n) > 0 THEN RAISE EXCEPTION 'Cash opener feeder minimum anchor absent'; END IF;
  EXECUTE n;

  -- A new Lightning game is a feeder game until it has enough players.
  -- Exactly one anchor, so a changed creator is refused rather than guessed.
  s := pg_get_functiondef('public.fn_cash_game_create_impl_20260905(uuid,text,text,numeric,numeric,integer,jsonb,text,boolean)'::regprocedure);
  IF (length(s) - length(replace(s, $o$'always_on',true$o$, ''))) / length($o$'always_on',true$o$) <> 1
     OR position($o$'always_on',false$o$ in s) > 0 THEN
    RAISE EXCEPTION 'Cash game creator always_on anchor changed';
  END IF;
  n := replace(s, $o$'always_on',true$o$, $n$'always_on',false$n$);
  EXECUTE n;
END $physical$;

-- Every existing Lightning game follows the owner's feeder-first rule. Only
-- always_on changes; thresholds and every other setting are untouched. The
-- existing drive then reverts an empty game through its own safe barrier.
UPDATE public.cash_games
   SET ruleset_snapshot = jsonb_set(ruleset_snapshot, '{lightning,always_on}', 'false'::jsonb, true),
       updated_at = now()
 WHERE lightning_enabled
   AND ruleset_snapshot ? 'lightning'
   AND ruleset_snapshot#>'{lightning,always_on}' IS DISTINCT FROM 'false'::jsonb;

DO $project$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.cash_games WHERE lightning_enabled AND enabled AND closed_at IS NULL ORDER BY id LOOP
    PERFORM public.fn_cash_apply_ruleset(r.id);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.cash_games
              WHERE lightning_enabled AND ruleset_snapshot#>'{lightning,always_on}' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'A Lightning game still holds always_on';
  END IF;
END $project$;
COMMIT;
