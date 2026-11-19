-- Fixture: the 20261118202500 repair. The row source is named chairs(chair),
-- so no reference is ambiguous; plpgsql_check must find no error.
CREATE TABLE IF NOT EXISTS public.ca_fixture_chair_clubs (user_id uuid, club_id uuid);
CREATE OR REPLACE FUNCTION public.ca_fixture_capture_fixed(p_participants jsonb)
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
  SELECT (chair->>'u')::uuid, (chair->>'c')::uuid FROM jsonb_array_elements(v_chairs) AS chairs(chair);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
