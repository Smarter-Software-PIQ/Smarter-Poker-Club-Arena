-- Give the winner's funded registration its actual chair in a running target.
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure))='89f1f51eb8066314e7722b3fb7a3fe18'
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  routine regprocedure := 'public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure;
  before_def text := pg_get_functiondef(routine);
BEGIN
  IF md5(before_def) IS DISTINCT FROM '6f086ea3f75dcc75a4b235ad9ba0f97c' OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid=routine AND pg_get_userbyid(proowner)='postgres'
      AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  ) THEN RAISE EXCEPTION 'SATELLITE_RUNNING_CHAIR_PREIMAGE_CHANGED'; END IF;
  EXECUTE replace(before_def,$before$      IF NOT v_diamond THEN  -- DIAMOND PHASE 9: the chip transfer and fee legs$before$,$after$      IF upper(v_target.status) = 'RUNNING' THEN
        DECLARE chair jsonb;
        BEGIN
          chair := public.fn_seat_late_registrant(v_target_id, v_finisher.user_id);
          IF (chair->>'ok')::boolean IS DISTINCT FROM true OR NOT EXISTS (
            SELECT 1 FROM public.tournament_players p
            JOIN public.tables t ON t.id=p.table_id AND t.tournament_id=p.tournament_id
            JOIN public.table_seats ts ON ts.table_id=t.id AND ts.user_id=p.user_id AND ts.seat_number=p.seat_number
            WHERE p.id=v_registration_id AND p.status='playing' AND ts.left_at IS NULL
          ) THEN
            RAISE EXCEPTION 'satellite % failed to seat running target registration %: %', p_tournament_id, v_registration_id, chair USING ERRCODE='55000';
          END IF;
        END;
      END IF;

      IF NOT v_diamond THEN  -- DIAMOND PHASE 9: the chip transfer and fee legs$after$);
  IF md5(pg_get_functiondef(routine)) IS DISTINCT FROM '89f1f51eb8066314e7722b3fb7a3fe18' THEN
    RAISE EXCEPTION 'SATELLITE_RUNNING_CHAIR_POSTIMAGE_CHANGED';
  END IF;
END $migration$;
COMMIT;
