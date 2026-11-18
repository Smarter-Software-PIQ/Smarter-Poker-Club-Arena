-- Execute the exact cap block installed by the migration, not a handwritten twin.
DO $build$
DECLARE body text;
BEGIN
  body := substring(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)
    FROM '  v_table_cap := g.cap_mains \+ 1;[\s\S]*?  IF g.enabled AND v_open_unreserved');
  IF body IS NULL THEN RAISE EXCEPTION 'installed capacity block missing'; END IF;
  body := replace(body, '  IF g.enabled AND v_open_unreserved', '');
  EXECUTE 'CREATE FUNCTION pg_temp.classic_cap(p_id uuid, p_at timestamptz, p_lightning boolean, p_cap integer DEFAULT 8, p_plo boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql AS $cap$ DECLARE g record; v_now timestamptz := p_at; v_table_cap integer; v_plo_lifecycle boolean := p_plo; BEGIN SELECT p_id id, p_lightning lightning_enabled, p_cap cap_mains, false allow_second_feeder INTO g; ' || body || ' RETURN v_table_cap; END $cap$';
END $build$;
DO $proof$
DECLARE g record; at timestamptz; cap integer; one_n integer:=0; two_n integer:=0; three_n integer:=0;
BEGIN
  FOR g IN SELECT id FROM cash_games WHERE id IS NOT NULL LOOP
    FOR hour IN 0..23 LOOP
      at := '2026-11-10T00:00:00-06:00'::timestamptz + hour * interval '1 hour';
      cap := pg_temp.classic_cap(g.id, at, false);
      IF cap NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'classic cap out of bounds'; END IF;
      IF cap=1 THEN one_n:=one_n+1; ELSIF cap=2 THEN two_n:=two_n+1; ELSE three_n:=three_n+1; END IF;
      IF (cap=3) IS DISTINCT FROM fn_cash_game_third_table_picked(g.id,at) THEN RAISE EXCEPTION 'third selection not applied'; END IF;
      IF cap>=2 AND NOT fn_cash_game_second_table_picked(g.id,at) THEN RAISE EXCEPTION 'third without second'; END IF;
      IF pg_temp.classic_cap(g.id,at,true)>2 THEN RAISE EXCEPTION 'Lightning capacity changed'; END IF;
      IF pg_temp.classic_cap(g.id,at,true,8,true)<2 THEN RAISE EXCEPTION 'PLO startup floor lost'; END IF;
      IF pg_temp.classic_cap(g.id,at,false,100)<>20 THEN RAISE EXCEPTION 'larger configured capacity reduced'; END IF;
    END LOOP;
  END LOOP;
  IF least(one_n,two_n,three_n)=0 THEN RAISE EXCEPTION 'room does not vary'; END IF;
  IF has_function_privilege('anon','fn_cash_game_third_table_picked(uuid,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'anonymous grant'; END IF;
  IF (fn_cash_cluster_tick(lpad('1',32,'0')::uuid)->>'skipped') <> 'frozen' THEN RAISE EXCEPTION 'freeze guard lost'; END IF;
END $proof$;
