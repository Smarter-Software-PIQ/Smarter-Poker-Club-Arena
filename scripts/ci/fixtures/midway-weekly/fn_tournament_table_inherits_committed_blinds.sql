CREATE OR REPLACE FUNCTION public.fn_tournament_table_inherits_committed_blinds()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_level integer; v_state jsonb; v_opening boolean;
BEGIN
  IF NEW.tournament_id IS NULL THEN RETURN NEW; END IF;
  SELECT current_level,blind_level_state,
    upper(coalesce(status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
      AND upper(coalesce(tournament_type,'')) IN ('MTT','SNG','SATELLITE')
      AND lower(coalesce(variant,'')) <> 'spin'
      AND started_at IS NULL AND coalesce(current_level,0)=0
    INTO v_level,v_state,v_opening
    FROM public.tournaments WHERE id=NEW.tournament_id FOR SHARE;
  IF v_state IS NULL THEN
    -- Pre-created MTT/SNG tables obey the same opening as their stored event.
    IF v_opening THEN NEW.small_blind:=25; NEW.big_blind:=50; END IF;
    -- No committed level to inherit. The display string is still a function of
    -- this row's own blinds, so derive it rather than trusting the caller:
    -- that is what let 'undefined/undefined' and stale levels be stored, and
    -- what left a minutely cron UPDATE as the only thing holding the invariant
    -- for the 167,997 tournaments with no blind_level_state.
    IF NEW.small_blind IS NOT NULL AND NEW.big_blind IS NOT NULL THEN
      NEW.stakes := trim_scale(NEW.small_blind)::text||'/'||trim_scale(NEW.big_blind)::text;
    END IF;
    RETURN NEW;
  END IF;
  IF (v_state->>'index')::integer IS DISTINCT FROM v_level THEN
    RAISE EXCEPTION 'Tournament table cannot inherit an unconfirmed blind level';
  END IF;
  NEW.small_blind:=(v_state->>'small_blind')::numeric;
  NEW.big_blind:=(v_state->>'big_blind')::numeric;
  NEW.ante:=(v_state->>'ante')::numeric;
  NEW.stakes:=trim_scale(NEW.small_blind)::text||'/'||trim_scale(NEW.big_blind)::text;
  RETURN NEW;
END;
$function$

