-- Owner November 1, 2026: buy-ins above 25 have 7-10 minute playable levels.
-- Preserve valid authored clocks and breaks; 25 itself and lower entries keep
-- their current rules. Existing funded Spin receipts are immutable: the engine
-- applies the playable projection, and future draws book the new clock.
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_tournament_lock_level_clock()'::regprocedure),'NEW.buy_in_amount > 25')>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

CREATE OR REPLACE FUNCTION public.fn_ca_high_buyin_structure_clock(
  p_structure jsonb,p_uniform boolean DEFAULT false,p_name text DEFAULT NULL,
  p_bounty boolean DEFAULT false,p_satellite boolean DEFAULT false,p_pinned boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $clock$
DECLARE bounded jsonb; minimum_minutes numeric; maximum_minutes numeric;
BEGIN
  SELECT COALESCE(jsonb_agg(CASE
    WHEN jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb
      AND minutes > 0 AND (minutes < 7 OR minutes > 10)
    THEN (e-'duration'-'duration_minutes') || jsonb_build_object('durationMinutes',LEAST(10,GREATEST(7,minutes)))
    ELSE e END ORDER BY ord),'[]'::jsonb),
    min(minutes) FILTER (WHERE jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb AND minutes>0),
    max(minutes) FILTER (WHERE jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb AND minutes>0)
  INTO bounded,minimum_minutes,maximum_minutes
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_structure)='array' THEN p_structure ELSE '[]'::jsonb END) WITH ORDINALITY x(e,ord)
  CROSS JOIN LATERAL (SELECT public.fn_ca_blind_contract_number(
    COALESCE(NULLIF(e->'durationMinutes','null'::jsonb),e->'duration_minutes')) AS authored_minutes) a
  CROSS JOIN LATERAL (SELECT CASE WHEN authored_minutes>0 THEN authored_minutes
    ELSE public.fn_ca_blind_contract_number(e->'duration')/60 END AS minutes) m;
  IF p_uniform THEN
    -- Preserve the previous one-clock-per-event MTT/satellite invariant.
    IF minimum_minutes=maximum_minutes AND minimum_minutes BETWEEN 7 AND 10 THEN RETURN p_structure; END IF;
    RETURN public.fn_ca_lock_structure_clock(p_structure,GREATEST(7,LEAST(
      public.fn_ca_locked_level_minutes(p_name,NULL,p_bounty,p_satellite,p_structure),
      CASE WHEN p_pinned IS TRUE THEN 10 ELSE 8 END)));
  END IF;
  RETURN bounded;
END;
$clock$;

DO $patch$
DECLARE
  d text;
  anchor constant text := 'BEGIN
  IF upper(COALESCE(NEW.tournament_type, '''')) NOT IN (''MTT'', ''SATELLITE'')';
  clause constant text := 'BEGIN
  -- Owner November 1: price takes precedence over every fast-format default.
  -- Booked Spin rules are never rewritten; their engine projection owns this.
  IF NEW.buy_in_amount > 25
     AND upper(COALESCE(NEW.tournament_type,'''')) <> ''SPIN''
     AND lower(COALESCE(NEW.variant,'''')) <> ''spin'' THEN
    IF TG_OP=''UPDATE'' AND upper(COALESCE(NEW.status,'''')) NOT IN (''REGISTERING'',''ANNOUNCED'',''SCHEDULED'',''PENDING'') THEN RETURN NEW; END IF;
    BEGIN authored:=NEW.blind_structure::jsonb;
    EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
    IF jsonb_typeof(authored)<>''array'' OR jsonb_array_length(authored)=0 THEN RETURN NEW; END IF;
    locked:=public.fn_ca_high_buyin_structure_clock(authored,
      upper(COALESCE(NEW.tournament_type,'''')) IN (''MTT'',''SATELLITE'') AND lower(COALESCE(NEW.variant,'''')) NOT IN (''spin'',''sng''),
      NEW.name,
      COALESCE(NEW.is_bounty,false) OR COALESCE(NEW.is_pko,false) OR COALESCE(NEW.is_mystery_bounty,false) OR COALESCE(NEW.bounty_amount,0)>0
        OR lower(COALESCE(NEW.variant,'''')) IN (''bounty'',''progressive_bounty'',''mystery_bounty''),
      upper(COALESCE(NEW.tournament_type,''''))=''SATELLITE'' OR lower(COALESCE(NEW.variant,''''))=''satellite'',NEW.is_pinned);
    IF locked IS DISTINCT FROM authored THEN
      IF COALESCE(NEW.late_reg_levels,0)>0 THEN
        BEGIN derived:=NEW.late_reg_mins=public.fn_ca_mtt_late_registration_minutes(authored,NEW.late_reg_levels);
        EXCEPTION WHEN OTHERS THEN derived:=false; END;
        IF derived THEN NEW.late_reg_mins:=public.fn_ca_mtt_late_registration_minutes(locked,NEW.late_reg_levels); END IF;
      END IF;
      NEW.blind_structure:=locked::text;
    END IF;
    RETURN NEW;
  END IF;
  IF upper(COALESCE(NEW.tournament_type, '''')) NOT IN (''MTT'', ''SATELLITE'')';
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_tournament_lock_level_clock()'::regprocedure)
       IS DISTINCT FROM 'ee70d8eb8a1f6b7511a0e131b483f649' THEN
    RAISE EXCEPTION 'HIGH_BUYIN_LEVEL_CLOCK_PREIMAGE_CHANGED';
  END IF;
  d:=pg_get_functiondef('public.fn_ca_tournament_lock_level_clock()'::regprocedure);
  IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'HIGH_BUYIN_LEVEL_CLOCK_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(d,anchor,clause);
END;
$patch$;

SELECT set_config('app.lock_level_clock','on',true);
UPDATE public.tournaments
 SET blind_structure=blind_structure
 WHERE buy_in_amount>25
   AND upper(COALESCE(status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
   AND upper(COALESCE(tournament_type,''))<>'SPIN'
   AND lower(COALESCE(variant,''))<>'spin'
   AND blind_structure::jsonb IS DISTINCT FROM public.fn_ca_high_buyin_structure_clock(blind_structure::jsonb);

-- Schedule buyIn includes fees. Use an occurrence whose actual price still
-- matches the current definition instead of guessing a fee split in SQL.
-- Definitions without an occurrence are bounded at creation by the same trigger.
UPDATE public.tournament_schedules s
 SET config=jsonb_set(config,'{blindStructure}',public.fn_ca_high_buyin_structure_clock(config->'blindStructure',
       lower(COALESCE(config->>'type','mtt')) NOT IN ('spin','sng'),COALESCE(config->>'name',s.name),
       COALESCE(public.fn_ca_blind_contract_number(config->'bountyAmount'),0)>0
         OR lower(COALESCE(config->>'type','')) IN ('bounty','progressive_bounty','mystery_bounty'),
       lower(COALESCE(config->>'type',''))='satellite',config->>'isFeatured'='true')),
     updated_at=now()
 WHERE jsonb_typeof(config->'blindStructure')='array'
   AND config->'blindStructure' IS DISTINCT FROM public.fn_ca_high_buyin_structure_clock(config->'blindStructure',
       lower(COALESCE(config->>'type','mtt')) NOT IN ('spin','sng'),COALESCE(config->>'name',s.name),
       COALESCE(public.fn_ca_blind_contract_number(config->'bountyAmount'),0)>0
         OR lower(COALESCE(config->>'type','')) IN ('bounty','progressive_bounty','mystery_bounty'),
       lower(COALESCE(config->>'type',''))='satellite',config->>'isFeatured'='true')
   AND lower(COALESCE(config->>'type',''))<>'spin'
   AND EXISTS (SELECT 1 FROM public.tournament_schedule_spawns ss
     JOIN public.tournaments t ON t.id=ss.tournament_id
     WHERE ss.schedule_id=s.id AND t.buy_in_amount>25
       AND upper(COALESCE(t.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
       AND t.buy_in_amount+COALESCE(t.buy_in_fee,0)=public.fn_ca_blind_contract_number(s.config->'buyIn'));
COMMIT;
