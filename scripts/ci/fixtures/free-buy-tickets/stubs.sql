-- Fixture-only collaborators for the Free Buy ticket rehearsal. None of these
-- is a candidate: each stands in for a production object the candidate reads
-- but does not change, so the ticket and cutoff paths run end to end.

-- pg_cron, enough for the candidate's schedule call.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
 LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
 LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_jobid RETURNING true$$;

-- Production's place guarantee (copied): the bounty pool counts toward it.
CREATE FUNCTION public.fn_ca_place_guarantee(p_guarantee numeric, p_bounty_pool numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public','pg_temp'
AS $$ SELECT greatest(0, round(coalesce(p_guarantee,0),2) - greatest(0, round(coalesce(p_bounty_pool,0),2))); $$;

-- No start-time overlay exists for these events (20261105034239).
CREATE FUNCTION public.fn_ca_return_excess_start_overlay_locked(uuid) RETURNS jsonb
 LANGUAGE sql AS $$SELECT NULL::jsonb$$;

-- The close-out core, reduced to what it publishes: the pool becomes
-- max(pool, place guarantee) and is marked finalized. A Free Buy reaching it
-- must already hold its guarantee (the candidate funds it from promo first),
-- so this stand-in refuses to invent an overlay rather than hide a gap.
-- fixture.core_refuses = 'on' makes it refuse, like a production refusal.
CREATE FUNCTION public.fn_ca_apply_prize_guarantee_core(p_tournament_id uuid, p_source text DEFAULT 'engine')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE t public.tournaments%ROWTYPE; g numeric;
BEGIN
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF current_setting('fixture.core_refuses',true)='on' THEN
    RETURN jsonb_build_object('ok',false,'reason','fixture_refusal','retryable',true);
  END IF;
  g := public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool);
  IF round(COALESCE(t.prize_pool,0),2) + 0.005 < g THEN
    RETURN jsonb_build_object('ok',false,'reason','fixture_core_would_need_a_bank_overlay',
      'prize_pool',t.prize_pool,'guaranteed_prize',g);
  END IF;
  UPDATE public.tournaments SET prize_pool_finalized=true WHERE id=p_tournament_id;
  RETURN jsonb_build_object('ok',true,'prize_pool',round(COALESCE(t.prize_pool,0),2),'overlay',0,
    'already_finalized',COALESCE(t.prize_pool_finalized,false));
END $$;

-- Production's escrow trigger for an overlay leg (copied).
CREATE FUNCTION public.fn_ca_escrow_on_overlay_leg() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.description, '') LIKE 'auto-ledgered%' THEN RETURN NULL; END IF;
  PERFORM public.fn_ca_escrow_apply(NEW.to_entity_id, 'overlay', p_overlay_in => round(NEW.amount, 2));
  RETURN NULL;
END $$;
CREATE TRIGGER zz_ca_escrow_overlay_leg AFTER INSERT ON public.chip_ledger FOR EACH ROW
 WHEN (NEW.to_type = 'prize_liability' AND (NEW.category = 'overlay'
   OR (NEW.category = 'correction' AND NEW.from_type IN ('union_bank','club_treasury'))))
 EXECUTE FUNCTION public.fn_ca_escrow_on_overlay_leg();

-- Production's entry refusal once a pool is finalized (copied).
CREATE FUNCTION public.trg_refuse_finalized_tournament_entry() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_finalized boolean;
BEGIN
  SELECT COALESCE(t.prize_pool_finalized, false) INTO v_finalized
    FROM public.tournaments t WHERE t.id = NEW.tournament_id FOR UPDATE;
  IF v_finalized THEN
    RAISE EXCEPTION 'registration is closed because tournament % prize pool is finalized',
      NEW.tournament_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_refuse_finalized_tournament_entry BEFORE INSERT ON public.tournament_players
 FOR EACH ROW EXECUTE FUNCTION public.trg_refuse_finalized_tournament_entry();

-- Production's finalization window guard (copied): nothing finalizes while
-- late registration, a rebuy level or a promised add-on window is open.
CREATE FUNCTION public.trg_tournament_pool_finalization_window_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_late_level_cap integer := COALESCE(NULLIF(NEW.late_reg_levels, 0), NULLIF(NEW.rebuy_levels, 0), 0);
  v_rebuy_level_cap integer := COALESCE(NULLIF(NEW.rebuy_levels, 0), NULLIF(NEW.late_reg_levels, 0), 0);
  v_current_level integer := COALESCE(NEW.current_level, 0);
  v_addon_open boolean := COALESCE(NEW.add_on_available, false)
                          AND NEW.addon_period_ends_at IS NOT NULL
                          AND clock_timestamp() < NEW.addon_period_ends_at;
BEGIN
  IF COALESCE(OLD.prize_pool_finalized, false) AND NOT COALESCE(NEW.prize_pool_finalized, false) THEN
    RAISE EXCEPTION 'finalized tournament % prize pool cannot be reopened', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT COALESCE(NEW.prize_pool_finalized, false) OR COALESCE(OLD.prize_pool_finalized, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('ANNOUNCED', 'REGISTERING')
     AND (v_late_level_cap > 0 OR COALESCE(NEW.late_reg_mins, 0) > 0
          OR COALESCE(NEW.is_rebuy, false) OR COALESCE(NEW.is_reentry, false)
          OR COALESCE(NEW.add_on_available, false)) THEN
    RAISE EXCEPTION 'tournament % cannot finalize its prize pool before its post-start entry windows open', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'RUNNING' THEN
    IF v_late_level_cap > 0 AND v_current_level < v_late_level_cap THEN
      RAISE EXCEPTION 'tournament % cannot finalize its prize pool before late registration level % closes',
        NEW.id, v_late_level_cap USING ERRCODE = 'check_violation';
    END IF;
    IF (COALESCE(NEW.is_rebuy, false) OR COALESCE(NEW.is_reentry, false))
       AND v_rebuy_level_cap > 0 AND v_current_level < v_rebuy_level_cap THEN
      RAISE EXCEPTION 'tournament % cannot finalize its prize pool before rebuy level % closes',
        NEW.id, v_rebuy_level_cap USING ERRCODE = 'check_violation';
    END IF;
    IF v_addon_open THEN
      RAISE EXCEPTION 'tournament % cannot finalize its prize pool before its promised add-on window closes', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzzz_tournament_pool_finalization_window_guard BEFORE UPDATE OF prize_pool_finalized
 ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.trg_tournament_pool_finalization_window_guard();
