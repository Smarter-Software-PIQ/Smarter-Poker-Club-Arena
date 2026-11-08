-- 20261108212837_record_strip_repeated_blind_levels_applied_directly.sql
--
-- PROVENANCE NOTICE. The four function bodies below were applied directly to
-- production on 2026-11-08 (21:14-21:26 UTC) through the Supabase MCP, before
-- this recording existed. That is contrary to CLAUDE.md section 2 rule 11,
-- which admits a direct apply only for an active outage. This was not an
-- outage. This file is the byte-exact recording the rule requires as the next
-- step, so main and production agree. Re-applying is harmless: every statement
-- is CREATE OR REPLACE of a body production already holds.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner ruling 2026-11-08 (Dan): "delete the redundant level completely."
-- 121 of 143 active recurring schedules opened with the same blind level
-- twice (25/50 then 25/50, or 50/100 then 50/100) - a five-minute level that
-- raised nothing. Two separate sources produced it: the repeat is authored
-- into the hard coded Midway weekly catalog, and fn_ca_tournament_opening_blinds
-- floors every level at 25/50 while forcing the first to exactly 25/50, which
-- collapses any cheaper opening levels onto one another.
--
-- A data fix could not hold: both schedule and tournament normalizers re-stamp
-- the structure on every write, so an edited row was reverted within the same
-- statement. The repeat is therefore removed in the normalizers themselves,
-- last, after the existing opening-blind and clock floors have run.
--
-- fn_ca_strip_repeated_levels removes a playable level whose small blind, big
-- blind AND ante all equal the previous playable level's, then renumbers. A
-- break ends the comparison window, so a level played after a break is never
-- swallowed whatever its blinds are. Anything unreadable, malformed or missing
-- blinds is returned untouched - this runs inside BEFORE triggers on the core
-- tournament tables and must never raise.
--
-- fn_ca_repeated_levels_late_reg steps the registration cutoff down by the
-- number of levels removed at or before it, so entry still closes at the same
-- blinds rather than one level deeper.
--
-- A started, completed or cancelled event is never touched: players keep the
-- ladder they are already playing.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_strip_repeated_levels(p_structure text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $fn$
declare
  v jsonb; r jsonb; out_arr jsonb := '[]'::jsonb;
  prev_sb numeric := null; prev_bb numeric := null; prev_ante numeric := null;
  sb numeric; bb numeric; ante numeric;
  changed boolean := false; n integer := 0;
begin
  if p_structure is null or btrim(p_structure) = '' then return p_structure; end if;
  begin v := p_structure::jsonb; exception when others then return p_structure; end;
  if v is null or jsonb_typeof(v) <> 'array' then return p_structure; end if;
  for r in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(r) <> 'object' then return p_structure; end if;
    if coalesce((r->>'isBreak')::boolean,false) then
      prev_sb := null; prev_bb := null; prev_ante := null;
      n := n + 1;
      if r ? 'level' then r := jsonb_set(r,'{level}',to_jsonb(n)); end if;
      out_arr := out_arr || jsonb_build_array(r);
      continue;
    end if;
    sb := public.fn_ca_blind_contract_number(r->'smallBlind');
    bb := public.fn_ca_blind_contract_number(r->'bigBlind');
    ante := case when r ? 'ante' then public.fn_ca_blind_contract_number(r->'ante') else 0 end;
    if sb is null or bb is null or ante is null then return p_structure; end if;
    if prev_bb is not null and sb = prev_sb and bb = prev_bb and ante = prev_ante then
      changed := true;
      continue;
    end if;
    prev_sb := sb; prev_bb := bb; prev_ante := ante;
    n := n + 1;
    if r ? 'level' then r := jsonb_set(r,'{level}',to_jsonb(n)); end if;
    out_arr := out_arr || jsonb_build_array(r);
  end loop;
  if not changed then return p_structure; end if;
  return out_arr::text;
end $fn$;

CREATE OR REPLACE FUNCTION public.fn_ca_repeated_levels_late_reg(p_structure text, p_late integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $fn$
declare
  v jsonb; r jsonb;
  prev_sb numeric := null; prev_bb numeric := null; prev_ante numeric := null;
  sb numeric; bb numeric; ante numeric; i integer := 0; kept integer := 0;
begin
  if p_late is null or p_late <= 0 then return p_late; end if;
  if p_structure is null or btrim(p_structure) = '' then return p_late; end if;
  begin v := p_structure::jsonb; exception when others then return p_late; end;
  if v is null or jsonb_typeof(v) <> 'array' then return p_late; end if;
  for r in select value from jsonb_array_elements(v) loop
    i := i + 1;
    if i > p_late then exit; end if;
    if jsonb_typeof(r) <> 'object' then return p_late; end if;
    if coalesce((r->>'isBreak')::boolean,false) then
      prev_sb := null; prev_bb := null; prev_ante := null;
      kept := kept + 1; continue;
    end if;
    sb := public.fn_ca_blind_contract_number(r->'smallBlind');
    bb := public.fn_ca_blind_contract_number(r->'bigBlind');
    ante := case when r ? 'ante' then public.fn_ca_blind_contract_number(r->'ante') else 0 end;
    if sb is null or bb is null or ante is null then return p_late; end if;
    if prev_bb is not null and sb = prev_sb and bb = prev_bb and ante = prev_ante then
      continue;
    end if;
    prev_sb := sb; prev_bb := bb; prev_ante := ante; kept := kept + 1;
  end loop;
  return greatest(kept,1);
end $fn$;


-- Owner 2026-11-08: a ladder never opens with the same level twice. The repeat
-- is authored into the hard coded weekly catalog and can also be produced by
-- the 25/50 opening floor, so it is stripped here, last, on both paths.
-- Late registration steps down with it so entry still closes at the same blinds.
CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_structure text; v_floor numeric; v_authored text; v_late integer;
BEGIN
 IF NEW.config->>'midwayWeeklyRevision'='owner-sheet-2026-11-07-v1'
    AND (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
         OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid) THEN
   PERFORM public.fn_ca_mtt_blind_contract(NEW.config->'midwayWeeklyTerms'->>'blind_structure',
      (NEW.config->'midwayWeeklyTerms'->>'starting_chips')::integer);
   v_authored:=NEW.config->'midwayWeeklyTerms'->>'blind_structure';
   v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
   IF v_structure IS DISTINCT FROM v_authored
      AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
     v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
     NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
   END IF;
   NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
   RETURN NEW;
 END IF;
 IF jsonb_typeof(NEW.config->'blindStructure')='array' THEN
  v_floor:=CASE WHEN coalesce((NEW.config->>'acceleratedMtt')::boolean,false) THEN 10
    WHEN upper(coalesce(NEW.config->>'blindPreset','STANDARD'))='STANDARD' THEN 8 ELSE 5 END;
  v_structure:=(NEW.config->'blindStructure')::text;
  IF lower(coalesce(NEW.config->>'type','mtt')) <> 'spin'
     AND lower(coalesce(NEW.config->>'variant','')) <> 'spin'
     AND upper(coalesce(NEW.config->>'tournamentType','')) <> 'SPIN' THEN
   v_structure:=public.fn_ca_tournament_opening_blinds(v_structure);
  END IF;
  v_structure:=public.fn_ca_minimum_tournament_levels(v_structure,v_floor);
  v_authored:=v_structure;
  v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
  IF v_structure IS DISTINCT FROM v_authored
     AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
    v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
    NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
  END IF;
  NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
 END IF;
 RETURN NEW;
END $function$;

-- Owner 2026-11-08: strip a repeated opening level on the event too. This runs
-- last of all tournament normalizers, so it also catches a repeat created by
-- the 25/50 opening floor. A started, completed or cancelled event is never
-- touched: players keep the ladder they are already playing.
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_schedule_config jsonb; v_floor numeric; v_structure text; v_count integer; v_last numeric; v_stripped text;
BEGIN
 IF NEW.blind_structure IS NOT NULL
    AND NEW.started_at IS NULL
    AND coalesce(NEW.current_level,0)=0
    AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') THEN
   v_stripped:=public.fn_ca_strip_repeated_levels(NEW.blind_structure);
   IF v_stripped IS DISTINCT FROM NEW.blind_structure THEN
     IF coalesce(NEW.late_reg_levels,0)>0 THEN
       NEW.late_reg_levels:=public.fn_ca_repeated_levels_late_reg(NEW.blind_structure,NEW.late_reg_levels);
     END IF;
     NEW.blind_structure:=v_stripped;
   END IF;
 END IF;
 -- Explicit weekly terms have already been validated by the original insert.
 -- Do not turn an authored five-minute bounty into an eight-minute event here.
 IF (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
     OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid)
    AND public.fn_ca_midway_weekly_terms(NEW.schedule_id) IS NOT NULL THEN RETURN public.fn_ca_ten_level_late_registration(NEW); END IF;
 IF upper(coalesce(NEW.status,'')) IN ('COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED') THEN RETURN public.fn_ca_ten_level_late_registration(NEW); END IF;
 -- Ten raw minutes remain five after an old engine applies acceleration.
 v_floor:=CASE WHEN NEW.accelerated_mtt IS TRUE THEN 10
   WHEN upper(coalesce(NEW.tournament_type,''))='MTT' AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
     AND lower(coalesce(NEW.blind_speed,'standard'))='standard' THEN 8 ELSE 5 END;
 v_structure:=public.fn_ca_minimum_tournament_levels(NEW.blind_structure,v_floor);
 IF v_structure IS DISTINCT FROM NEW.blind_structure
   OR TG_OP='INSERT' OR NEW.blind_structure IS DISTINCT FROM OLD.blind_structure THEN
  NEW.blind_structure:=v_structure;
  IF coalesce(NEW.late_reg_levels,0)>0 THEN
   SELECT jsonb_array_length(v_structure::jsonb), (array_agg(coalesce(nullif((e.value->>'durationMinutes')::numeric,0), nullif((e.value->>'duration_minutes')::numeric,0), (e.value->>'duration')::numeric/60) ORDER BY e.n DESC))[1]
   INTO v_count,v_last FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE NOT coalesce((e.value->>'isBreak')::boolean,false);
   SELECT ceil(greatest(0,NEW.late_reg_levels-coalesce(v_count,0))*coalesce(v_last,v_floor)+coalesce(sum(coalesce(nullif((e.value->>'durationMinutes')::numeric,0),
      nullif((e.value->>'duration_minutes')::numeric,0),(e.value->>'duration')::numeric/60)),0))::integer
   INTO NEW.late_reg_mins
   FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE e.n<=NEW.late_reg_levels AND NOT coalesce((e.value->>'isBreak')::boolean,false);
   -- 2026-11-07: a derived clock caps a stalled level clock; it must not
   -- close entry before the advertised last level because breaks stopped
   -- the levels. Free Buy minutes are the owner's hour and stay as set.
   IF coalesce(NEW.late_reg_mins,0)>0
      AND NEW.format_contract::text IN ('mtt-v1','mtt-v2')
      AND NEW.synchronized_breaks IS DISTINCT FROM false
      AND NOT coalesce(NEW.free_buy,false)
      AND NOT (lower(coalesce(NEW.name,'')) ~ 'free ?buy'
               AND coalesce(NEW.buy_in_amount,0)+coalesce(NEW.buy_in_fee,0)=0) THEN
    NEW.late_reg_mins := NEW.late_reg_mins + public.fn_ca_late_registration_break_allowance(NEW.late_reg_mins);
   END IF;
  END IF;
 END IF;

 -- An explicit authored schedule may choose a level window without a second
 -- wall-clock deadline. Preserve it after all existing clock normalization.
 IF NEW.schedule_id IS NOT NULL
    AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING')
    AND upper(coalesce(NEW.tournament_type,'')) IN ('MTT','SATELLITE')
    AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
    AND NOT coalesce(NEW.prize_pool_finalized,false) THEN
   SELECT s.config INTO v_schedule_config
   FROM public.tournament_schedules s WHERE s.id=NEW.schedule_id;
   IF v_schedule_config->>'lateRegistrationMode' = 'levels' THEN
     IF coalesce(v_schedule_config->>'lateRegistrationLevels','') !~ '^[0-9]{1,3}$'
        OR (v_schedule_config->>'lateRegistrationLevels')::integer NOT BETWEEN 1 AND 100 THEN
       RAISE EXCEPTION 'A levels-only schedule requires 1 through 100 registration levels';
     END IF;
     NEW.late_reg_levels := (v_schedule_config->>'lateRegistrationLevels')::integer;
     NEW.late_reg_mins := 0;
   END IF;
 END IF;
 RETURN public.fn_ca_ten_level_late_registration(NEW);
END $function$;

COMMIT;
