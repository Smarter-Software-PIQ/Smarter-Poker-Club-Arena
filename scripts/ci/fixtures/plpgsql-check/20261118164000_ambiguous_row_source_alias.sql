-- Fixture: the 2026-11-18 defect (incident d2d79c4f). The row source alias x
-- is also the function's loop variable; PL/pgSQL refuses the reference (42702)
-- only when the function runs. plpgsql_check must name it statically.
CREATE TABLE IF NOT EXISTS public.ca_fixture_chair_clubs (user_id uuid, club_id uuid);
CREATE OR REPLACE FUNCTION public.ca_fixture_capture(p_participants jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE x jsonb; v_chairs jsonb := '[]'; v_n integer;
BEGIN
  FOR x IN SELECT value FROM jsonb_array_elements(p_participants) LOOP
    v_chairs := v_chairs || jsonb_build_array(jsonb_build_object('u', x->>'user_id', 'c', x->>'club_id'));
  END LOOP;
  INSERT INTO public.ca_fixture_chair_clubs(user_id, club_id)
  SELECT (x->>'u')::uuid, (x->>'c')::uuid FROM jsonb_array_elements(v_chairs) x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
