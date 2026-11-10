-- 20261110144349_the_level_clock_keeps_the_satellite_name.sql
--
-- Version reserved by scripts/new-migration.mjs.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-08: a satellite is named "Satellite Into <target>",
-- and no event ever says "0 GTD"):
--
-- On INSERT of a Midway weekly row, two BEFORE triggers restamp the catalog terms with
-- NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(schedule_id)):
-- tournaments_creation_guard, then tournaments_lock_level_clock. The copy rules run between
-- them (tournaments_d_copy_follows_the_weekly_terms), so the level clock's restamp put the
-- catalog name back: weekly satellites were stored as "40 Chip Freezeout - 0 GTD (NLH)
-- Satellite 5" (7eae51cb, 2026-11-09 18:00:12Z) and five others.
--
-- 20261109180446 (#10204) moves the copy trigger instead, but that is DDL on public.tournaments
-- and is queued for the daily maintenance window (#10235), which did not run on 2026-11-10.
-- This is the root fix in the writer itself and takes no lock on tournaments: both restamps
-- apply under the same condition on INSERT (house club or union, not started, a pre-start
-- status, terms present), so the level clock's copy of `name` and `short_description` is
-- always a repeat of what the creation guard already applied and the copy trigger already
-- corrected. Every other term is still restamped exactly as before.
--
-- The body is 20261107175806's definition (md5 of prosrc 06215a4026fe417ace9935b3ecfdb6d3,
-- equal to production on 2026-11-10) with that one line changed; the install refuses if the
-- installed body has drifted. Open satellites still carrying a catalog name are renamed once
-- through the name edit the lifecycle guard admits, oldest first (the later of two feeding one
-- target becomes "#2"). Names only.
--
-- @live-proof: (position($p$fn_ca_midway_weekly_terms(NEW.schedule_id)-'name'-'short_description'$p$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ca_tournament_lock_level_clock()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.tournaments s WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL) AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED') AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL AND s.name NOT LIKE 'Satellite Into %'))

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $drift$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_tournament_lock_level_clock()'::regprocedure)
     IS DISTINCT FROM '06215a4026fe417ace9935b3ecfdb6d3' THEN
    RAISE EXCEPTION 'fn_ca_tournament_lock_level_clock drifted from 20261107175806; re-derive this migration'
      USING ERRCODE = '55000';
  END IF;
END
$drift$;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_lock_level_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  authored jsonb;
  locked jsonb;
  m integer;
  derived boolean := false;
BEGIN
  -- The November 7 owner sheet supersedes category-based clock/opening defaults.
  -- Creation is the only authority that applies the new entry contract. An
  -- existing funded or running event is never rewritten by this normalizer.
  IF (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
      OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid)
     AND public.fn_ca_midway_weekly_terms(NEW.schedule_id) IS NOT NULL THEN
    IF TG_OP='INSERT' AND NEW.started_at IS NULL
       AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') THEN
      -- The copy is already settled: tournaments_creation_guard stamped these same terms
      -- earlier on this INSERT and the copy trigger then named the event (no "0 GTD",
      -- "Satellite Into <target>"). Restamping the catalog copy here undid that.
      NEW:=jsonb_populate_record(NEW,public.fn_ca_midway_weekly_terms(NEW.schedule_id)-'name'-'short_description');
      PERFORM public.fn_ca_mtt_blind_contract(NEW.blind_structure,NEW.starting_chips);
    END IF;
    RETURN NEW;
  END IF;
  -- Owner November 5: MTTs and Sit & Gos open at 25/50. Keep every
  -- level index, clock, ante and already booked Spin receipt intact.
  IF (TG_OP='INSERT' OR upper(coalesce(OLD.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING'))
     AND upper(coalesce(NEW.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
     AND upper(coalesce(NEW.tournament_type,'')) IN ('MTT','SNG','SATELLITE')
     AND lower(coalesce(NEW.variant,'')) <> 'spin'
     AND NEW.started_at IS NULL AND coalesce(NEW.current_level,0)=0
     THEN
    NEW.blind_structure:=public.fn_ca_tournament_opening_blinds(NEW.blind_structure);
  END IF;
  -- Owner November 1: price takes precedence over every fast-format default.
  -- Booked Spin rules are never rewritten; their engine projection owns this.
  IF NEW.buy_in_amount > 25
     AND upper(COALESCE(NEW.tournament_type,'')) <> 'SPIN'
     AND lower(COALESCE(NEW.variant,'')) <> 'spin' THEN
    IF TG_OP='UPDATE' AND upper(COALESCE(NEW.status,'')) NOT IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING') THEN RETURN NEW; END IF;
    BEGIN authored:=NEW.blind_structure::jsonb;
    EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
    IF jsonb_typeof(authored)<>'array' OR jsonb_array_length(authored)=0 THEN RETURN NEW; END IF;
    locked:=public.fn_ca_high_buyin_structure_clock(authored,
      upper(COALESCE(NEW.tournament_type,'')) IN ('MTT','SATELLITE') AND lower(COALESCE(NEW.variant,'')) NOT IN ('spin','sng'),
      NEW.name,
      COALESCE(NEW.is_bounty,false) OR COALESCE(NEW.is_pko,false) OR COALESCE(NEW.is_mystery_bounty,false) OR COALESCE(NEW.bounty_amount,0)>0
        OR lower(COALESCE(NEW.variant,'')) IN ('bounty','progressive_bounty','mystery_bounty'),
      upper(COALESCE(NEW.tournament_type,''))='SATELLITE' OR lower(COALESCE(NEW.variant,''))='satellite',NEW.is_pinned);
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
  IF upper(COALESCE(NEW.tournament_type, '')) NOT IN ('MTT', 'SATELLITE')
     OR lower(COALESCE(NEW.variant, '')) IN ('spin', 'sng') THEN
    -- Short formats keep their own faster ladder, subject to the global ceiling.
    IF TG_OP='UPDATE' AND upper(COALESCE(NEW.status,'')) NOT IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING') THEN RETURN NEW; END IF;
    BEGIN authored:=NEW.blind_structure::jsonb;
    EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
    IF jsonb_typeof(authored)='array' THEN
      NEW.blind_structure:=public.fn_ca_cap_structure_clock(authored,CASE WHEN NEW.is_pinned IS TRUE THEN 10 ELSE 8 END)::text;
    END IF;
    RETURN NEW;
  END IF;
  -- A started event keeps the clock its players are already playing.
  IF TG_OP = 'UPDATE' AND upper(COALESCE(NEW.status, ''))
       NOT IN ('REGISTERING', 'ANNOUNCED', 'SCHEDULED', 'PENDING') THEN
    RETURN NEW;
  END IF;
  BEGIN
    authored := NEW.blind_structure::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- unreadable ladders are refused by the blind contract trigger
  END;
  IF authored IS NULL OR jsonb_typeof(authored) <> 'array' OR jsonb_array_length(authored) = 0 THEN
    RETURN NEW;
  END IF;

  m := public.fn_ca_locked_level_minutes(
    NEW.name,
    CASE WHEN NEW.buy_in_amount IS NULL THEN NULL
         ELSE NEW.buy_in_amount + COALESCE(NEW.buy_in_fee, 0) END,
    COALESCE(NEW.is_bounty, false) OR COALESCE(NEW.is_pko, false)
      OR COALESCE(NEW.is_mystery_bounty, false) OR COALESCE(NEW.bounty_amount, 0) > 0
      OR lower(COALESCE(NEW.variant, '')) IN ('bounty', 'progressive_bounty', 'mystery_bounty'),
    upper(COALESCE(NEW.tournament_type, '')) = 'SATELLITE'
      OR lower(COALESCE(NEW.variant, '')) = 'satellite',
    authored);
  -- Only highlighted tournaments may retain the ten-minute clock.
  m := LEAST(m, CASE WHEN NEW.is_pinned IS TRUE THEN 10 ELSE 8 END);
  locked := public.fn_ca_lock_structure_clock(authored, m);

  IF locked IS DISTINCT FROM authored THEN
    IF COALESCE(NEW.late_reg_levels, 0) > 0 THEN
      BEGIN
        derived := NEW.late_reg_mins = public.fn_ca_mtt_late_registration_minutes(authored, NEW.late_reg_levels);
      EXCEPTION WHEN OTHERS THEN
        derived := false;
      END;
      IF derived THEN
        NEW.late_reg_mins := public.fn_ca_mtt_late_registration_minutes(locked, NEW.late_reg_levels);
      END IF;
    END IF;
    NEW.blind_structure := locked::text;
  END IF;

  -- Free Buy: one hour of late registration on the 5-minute clock.
  IF upper(COALESCE(NEW.tournament_type, '')) = 'MTT'
     AND lower(COALESCE(NEW.name, '')) ~ 'free ?buy'
     AND COALESCE(NEW.buy_in_amount, 0) + COALESCE(NEW.buy_in_fee, 0) = 0
     AND m = 5
     AND COALESCE(NEW.late_reg_levels, 0) > 0
     AND (NEW.late_reg_levels, NEW.late_reg_mins) IS DISTINCT FROM (12, 60) THEN
    IF NEW.rebuy_levels IS NOT DISTINCT FROM NEW.late_reg_levels THEN
      NEW.rebuy_levels := 12;
    END IF;
    NEW.late_reg_levels := 12;
    NEW.late_reg_mins := 60;
  END IF;
  RETURN NEW;
END;
$function$;

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.id FROM public.tournaments s
     WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL)
       AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL
       AND s.name NOT LIKE 'Satellite Into %'
     ORDER BY s.created_at, s.id
  LOOP
    UPDATE public.tournaments s
       SET name = public.fn_ca_satellite_name_for_row(
             s.id, s.club_id, s.tournament_type, s.status, s.start_time,
             s.schedule_id, s.satellite_target_id, s.satellite_target)
     WHERE s.id = r.id;
  END LOOP;
END
$backfill$;

DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournaments s
     WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL)
       AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL
       AND s.name NOT LIKE 'Satellite Into %'
  ) THEN
    RAISE EXCEPTION 'an open satellite is still not named for its target';
  END IF;
END
$assert$;

COMMIT;
