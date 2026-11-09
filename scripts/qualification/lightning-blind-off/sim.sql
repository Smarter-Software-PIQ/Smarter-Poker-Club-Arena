-- The seat triggers exactly as production declares them (pg_get_triggerdef).
CREATE CONSTRAINT TRIGGER trg_table_seats_lightning_pool_follows_seat AFTER UPDATE ON public.table_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((old.left_at IS DISTINCT FROM new.left_at) OR (old.user_id IS DISTINCT FROM new.user_id) OR (old.is_sitting_out IS DISTINCT FROM new.is_sitting_out) OR (old.leave_pending IS DISTINCT FROM new.leave_pending) OR ((COALESCE(old.stack, (0)::numeric) > (0)::numeric) IS DISTINCT FROM (COALESCE(new.stack, (0)::numeric) > (0)::numeric)))) EXECUTE FUNCTION fn_table_seats_lightning_pool_follows_seat();
CREATE CONSTRAINT TRIGGER trg_table_seats_lightning_pool_on_insert AFTER INSERT ON public.table_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.left_at IS NULL) AND (new.user_id IS NOT NULL) AND (COALESCE(new.stack, (0)::numeric) > (0)::numeric) AND (COALESCE(new.is_sitting_out, false) = false) AND (COALESCE(new.leave_pending, false) = false))) EXECUTE FUNCTION fn_table_seats_lightning_pool_follows_seat();

-- The fixture's stand-ins for the engine: the matcher pass (legality decides
-- who is dealt; the settlement reports each dealt hand to the hand count),
-- the leave confirmation, and the held-leave release through the leave door.
CREATE FUNCTION sim.c() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT '70000000-0000-4000-8000-000000000001'::uuid$$;
CREATE FUNCTION sim.t() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT '30000000-0000-4000-8000-000000000001'::uuid$$;
CREATE FUNCTION sim.h() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT '10000000-0000-4000-8000-000000000001'::uuid$$;
CREATE FUNCTION sim.mode() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('test.mode')$$;
CREATE FUNCTION sim.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION 'FAILED [%] %', sim.mode(), label; END IF; RETURN 'ok ' || label; END$$;

-- Six funded anchor seats; the pool's own door (the seat trigger) enters
-- each. The hero is in profit, 3 of 10 hands played, acknowledged by the engine.
CREATE FUNCTION sim.reset(p_hero_stack numeric DEFAULT 40, p_played integer DEFAULT 3) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i integer; u uuid;
BEGIN
  TRUNCATE clubs, cash_games, cash_cluster_epoch, tables, table_seats, seat_departure_requests, cash_player_session,
    lightning_pool_session, lightning_pool_slot, lightning_instance, lightning_reservation, lightning_hand_player,
    cash_cluster_events, responsible_gaming_limits;
  INSERT INTO clubs(id) VALUES ('c0000000-0000-4000-8000-000000000001');
  INSERT INTO cash_games(id, cluster_mode) VALUES (sim.c(), 'lightning');
  INSERT INTO cash_cluster_epoch VALUES (sim.c(), 1, NULL);
  INSERT INTO tables(id, club_id, cluster_id) VALUES (sim.t(), 'c0000000-0000-4000-8000-000000000001', sim.c());
  FOR i IN 1 .. 6 LOOP
    u := ('10000000-0000-4000-8000-00000000000' || i)::uuid;
    INSERT INTO cash_player_session(player_id, scope_type, scope_id, table_id, cluster_id, baseline, hr_engine_ack,
        hr_hands_required, hr_hands_played, hr_reference_stack, hr_started_at)
    VALUES (u, 'table', sim.t(), sim.t(), sim.c(), CASE WHEN i = 1 THEN 25 ELSE 30 END, true,
        CASE WHEN i = 1 AND p_hero_stack > 25 THEN 10 ELSE 0 END, CASE WHEN i = 1 AND p_hero_stack > 25 THEN p_played ELSE 0 END,
        CASE WHEN i = 1 AND p_hero_stack > 25 THEN p_hero_stack END, CASE WHEN i = 1 AND p_hero_stack > 25 THEN now() - interval '1 minute' END);
    INSERT INTO table_seats(table_id, user_id, seat_number, stack) VALUES (sim.t(), u, i, CASE WHEN i = 1 THEN p_hero_stack ELSE 30 END);
  END LOOP;
END$$;

CREATE FUNCTION sim.deal(p_disconnected uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_players uuid[]; v_sessions uuid[]; v_reason text; v_hand uuid := gen_random_uuid(); v_blind boolean;
BEGIN
  SELECT array_agg(l.player_id), array_agg(l.pool_session_id) INTO v_players, v_sessions
    FROM fn_lightning_player_legality(sim.c(), clock_timestamp(), p_disconnected, NULL) l WHERE l.legal;
  SELECT l.reason_code INTO v_reason
    FROM fn_lightning_player_legality(sim.c(), clock_timestamp(), p_disconnected, NULL) l WHERE l.player_id = sim.h();
  IF coalesce(array_length(v_players, 1), 0) < 5 THEN
    RETURN jsonb_build_object('dealt', false, 'reason', 'POOL_SHORT');
  END IF;
  v_blind := sim.h() IN (SELECT fn_lightning_blind_off_players(v_sessions));
  PERFORM set_config('test.engine', 'true', true);
  PERFORM fn_cash_session_evaluate(sim.t(), (SELECT jsonb_agg(jsonb_build_object('user_id', p, 'active', true,
    'hit_run', true, 'hand_id', v_hand::text, 'hand_source', 'lightning')) FROM unnest(v_players) p));
  RETURN jsonb_build_object('dealt', sim.h() = ANY (v_players), 'blind_off', v_blind, 'reason', v_reason);
END$$;

CREATE FUNCTION sim.deal_many(n integer, p_disconnected uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i integer; k integer := 0; r jsonb;
BEGIN
  FOR i IN 1 .. n LOOP
    r := sim.deal(p_disconnected);
    -- An absent seat may only ever be dealt as a blind off its hand host folds.
    IF (r ->> 'dealt')::boolean AND NOT (r ->> 'blind_off')::boolean AND sim.h() = ANY (p_disconnected) THEN
      RAISE EXCEPTION 'an absent seat was dealt without a blind off';
    END IF;
    IF (r ->> 'dealt')::boolean AND (r ->> 'blind_off')::boolean THEN k := k + 1; END IF;
  END LOOP;
  RETURN k;
END$$;

CREATE FUNCTION sim.confirm() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('test.engine', 'true', true); RETURN fn_cash_session_set_blind_off(sim.t(), sim.h(), true); END$$;

CREATE FUNCTION sim.stop() RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('test.uid', sim.h()::text, true); RETURN fn_lightning_stop_playing(sim.c()); END$$;

CREATE FUNCTION sim.disconnect(p_age interval DEFAULT '10 minutes') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_lightning_presence_report(sim.c(), ARRAY[sim.h()], ARRAY[]::uuid[]);
  UPDATE lightning_pool_session SET disconnected_at = disconnected_at - p_age WHERE player_id = sim.h() AND exited_at IS NULL;
END$$;

-- The anchor engine's held-leave release: the voluntary door, then the seat leaves.
CREATE FUNCTION sim.release() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v boolean := (fn_cash_leave_check(sim.h(), sim.t()) ->> 'allowed')::boolean;
BEGIN
  IF v THEN UPDATE table_seats SET left_at = now() WHERE table_id = sim.t() AND user_id = sim.h() AND left_at IS NULL; END IF;
  RETURN v;
END$$;

CREATE FUNCTION sim.state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'played', cs.hr_hands_played, 'required', cs.hr_hands_required, 'completed', cs.hr_completed, 'blind_off', cs.hr_blind_off,
    'leave_allowed', (fn_cash_leave_check(sim.h(), sim.t()) ->> 'allowed')::boolean,
    'seat_live', ts.left_at IS NULL, 'stack', ts.stack,
    'pool_open', EXISTS (SELECT 1 FROM lightning_pool_session p WHERE p.player_id = sim.h() AND p.exited_at IS NULL),
    'stop_mark', EXISTS (SELECT 1 FROM lightning_pool_session p WHERE p.player_id = sim.h() AND p.exited_at IS NULL AND p.stop_requested_at IS NOT NULL),
    'last_exit', (SELECT p.exit_reason FROM lightning_pool_session p WHERE p.player_id = sim.h() ORDER BY p.entered_at DESC, p.exited_at DESC NULLS FIRST LIMIT 1),
    'open_slots', (SELECT count(*) FROM lightning_pool_slot sl WHERE sl.player_id = sim.h() AND sl.closed_at IS NULL))
  FROM cash_player_session cs JOIN table_seats ts ON ts.table_id = cs.table_id AND ts.user_id = cs.player_id
 WHERE cs.player_id = sim.h()$$;
