CREATE OR REPLACE FUNCTION public.fn_tournaments_creation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_paid int;
BEGIN
  IF public.fn_ca_new_tournament_is_unlimited(to_jsonb(NEW)) THEN
    RETURN NEW; -- The earlier normalizer and final recorded-format constraint own NULL.
  END IF;
  IF COALESCE(NEW.max_players, 0) <= 0 THEN
    RAISE EXCEPTION
      'tournament guard: max_players must be positive (got %) - a tournament with no seats can never start',
      NEW.max_players
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payout_structure IS NOT NULL
     AND jsonb_typeof(NEW.payout_structure::jsonb) = 'array' THEN
    v_paid := jsonb_array_length(NEW.payout_structure::jsonb);
    IF v_paid > NEW.max_players THEN
      RAISE EXCEPTION
        'tournament guard: % paid places for % seats - more places than players who can enter',
        v_paid, NEW.max_players
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
