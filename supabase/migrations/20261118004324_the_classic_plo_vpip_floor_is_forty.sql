-- THE CLASSIC PLO VPIP FLOOR IS 40 (Dan, 2026-11-17: "lower the vpip down to 40%").
--
-- The floor a Classic plo5/plo6 table keeps was not stored in one place.
-- fn_cash_game_floor_from_template resolves the template default first and then
-- RAISES it with GREATEST against the ca_classic_vpip_floors config row, so the
-- live value was the larger of two numbers that were both 50:
--
--   1. fn_cash_template_defaults('classic','plo5'|'plo6') -> 'vpip_floor' = 50
--   2. ca_classic_vpip_floors.floor_percent for plo5/plo6  = 50
--
-- Lowering either one on its own changes nothing, because GREATEST keeps the
-- other at 50. That is why this migration moves both, and why "just change the
-- config row" would have looked applied and done nothing at all.
--
-- MADNESS KEEPS 50, AND CANNOT LOSE IT HERE. The trigger's
-- madness_without_lightning branch pins vpip_floor to 50 explicitly BEFORE the
-- GREATEST runs, so lowering either source above cannot reach it. That is load
-- bearing in two other places:
--   * server/src/services/HorseMadnessSelection.ts identifies a Madness table by
--     Number(table.maintain_percent_min) === 50, and orders its horse candidates
--     by measured PLO performance only there.
--   * 20261024200548_plo5_one_two_madness_without_lightning.sql carries an
--     @live-proof asserting that cluster still reads 50.
--
-- The whole function is written out rather than patched by substitution, so the
-- laws that read the newest definition of fn_cash_template_defaults - the 50 BB
-- minimum among them - can still see the body they check. The guard below pins
-- the pre-image, and the verify block pins the post-image, so a drifted source
-- or a mistyped transcription is refused rather than installed.
--
-- RE-RUNNABLE ON PURPOSE: the merger dispatches a merged migration to
-- apply-merged-migration.yml, so a second run must be a clean no-op.

BEGIN;

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_template_defaults';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'fn_cash_template_defaults is missing';
  END IF;

  IF v_md5 NOT IN ('112ace6ab51cebe8a86a75e5701eb911',
                   '6ad34a35974530555157dcf9e4f299c6') THEN
    RAISE EXCEPTION 'fn_cash_template_defaults drifted (md5=%), refusing to edit', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults(p_template text, p_variant text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE t text:=lower(coalesce(p_template,'classic')); v text:=lower(coalesce(p_variant,'nlh')); family text; seats int;
BEGIN
 IF t IN ('action','madness','lightning') THEN t:='madness'; END IF;
 IF t NOT IN ('classic','madness') THEN RAISE EXCEPTION 'TEMPLATE_UNKNOWN: %',p_template; END IF;
 IF t='madness' AND v IN ('pineapple','pineapple_holdem') THEN
  RAISE EXCEPTION 'LIGHTNING_VARIANT_NOT_SUPPORTED: Pineapple Uses Classic Games';
 END IF;
 family:=CASE WHEN v IN ('plo4','plo5','plo6','plo8','flo8') THEN 'plo' WHEN v='short_deck' THEN 'shortdeck' WHEN v='pineapple' THEN 'pineapple' ELSE 'holdem' END;
 seats:=CASE WHEN t='classic' AND family='holdem' THEN 9 ELSE 6 END;
 RETURN jsonb_build_object('template',t,'variant',v,'family',family,'seats',seats,
  'seats_locked',t='madness' OR family='plo',
  'seat_choices',CASE WHEN t='madness' OR family='plo' THEN '[6]'::jsonb WHEN family='holdem' THEN '[9,6]'::jsonb ELSE '[2,3,4,5,6,7,8]'::jsonb END,
  -- Dan 2026-11-08: every cash game's minimum buy-in is exactly 50 BB.
  'min_buyin_bb',50,'max_buyin_bb',CASE WHEN v IN ('flh','flo8') THEN NULL ELSE 200 END,
  'regular_ante',CASE WHEN t='classic' AND v NOT IN ('plo5','plo6') THEN 'none' ELSE 'bb' END,
  'vpip_floor',CASE WHEN t='classic' AND v IN ('plo5','plo6') THEN 40 WHEN t='classic' THEN 0 ELSE 40 END,'vpip_window',10,
  'bombs',jsonb_build_object('enabled',t<>'classic','trigger',CASE WHEN t='classic' THEN NULL ELSE 'timed_30m' END,'ante_bb',CASE WHEN t='classic' THEN NULL ELSE 3 END,'boards',CASE WHEN t='classic' THEN NULL ELSE 2 END),
  'straddle',false,'stay_clock_min',10,'rejoin_window_min',120,'run_it_n_times','opt_in','rake','existing');
END $fn$;

-- The judgment row moves with the template default, so the two sources agree at
-- 40 and neither can raise the other back to 50.
UPDATE public.ca_classic_vpip_floors
   SET floor_percent = 40,
       note = 'Owner value 2026-11-17: lowered from 50 to 40. Madness keeps 50 via '
              'the trigger''s madness_without_lightning branch.',
       updated_at = now()
 WHERE variant IN ('plo5', 'plo6')
   AND floor_percent IS DISTINCT FROM 40;

-- Re-resolve the open Classic clusters. Touching ruleset_snapshot is what fires
-- zz_cash_game_floor_from_template, which recomputes the floor from the two
-- sources above. Madness is excluded explicitly as well as by the trigger.
UPDATE public.cash_games
   SET ruleset_snapshot = ruleset_snapshot || jsonb_build_object('vpip_floor', 40)
 WHERE template_name = 'classic'
   AND variant IN ('plo5', 'plo6')
   AND COALESCE(ruleset_snapshot->>'rules_profile', '') <> 'madness_without_lightning'
   AND closed_at IS NULL
   AND (ruleset_snapshot->>'vpip_floor') IS DISTINCT FROM '40';

-- An existing table carries its own materialized copy of the cluster's floor and
-- a cluster edit does not reach it, so bring the live Classic PLO tables across.
-- Retired clubs are excluded on purpose: fn_guard_retired_club_mutation makes
-- their gameplay records read-only, and the tables still reading 50 there are
-- spent certification fixtures, not games anyone is sitting at.
UPDATE public.tables t
   SET maintain_percent_min = 40
  FROM public.cash_games cg, public.clubs c
 WHERE cg.id = t.cluster_id
   AND c.id = t.club_id
   AND c.lifecycle_status <> 'retired'
   AND cg.template_name = 'classic'
   AND cg.variant IN ('plo5', 'plo6')
   AND COALESCE(cg.ruleset_snapshot->>'rules_profile', '') <> 'madness_without_lightning'
   AND COALESCE(t.is_deleted, false) = false
   AND t.nit_game IS TRUE
   AND t.maintain_percent_min IS DISTINCT FROM 40;

-- Fail closed on every invariant this change could have broken.
DO $verify$
DECLARE
  v_md5             text;
  v_classic_default int;
  v_cfg             int;
  v_classic_wrong   int;
  v_madness_moved   int;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_template_defaults';
  IF v_md5 <> '6ad34a35974530555157dcf9e4f299c6' THEN
    RAISE EXCEPTION 'fn_cash_template_defaults post-image is %, expected 6ad34a35974530555157dcf9e4f299c6', v_md5;
  END IF;

  SELECT (public.fn_cash_template_defaults('classic','plo5')->>'vpip_floor')::int
    INTO v_classic_default;
  IF v_classic_default <> 40 THEN
    RAISE EXCEPTION 'classic plo5 template default is %, expected 40', v_classic_default;
  END IF;

  SELECT min(floor_percent) INTO v_cfg
    FROM public.ca_classic_vpip_floors WHERE variant IN ('plo5','plo6');
  IF v_cfg <> 40 THEN
    RAISE EXCEPTION 'ca_classic_vpip_floors plo5/plo6 is %, expected 40', v_cfg;
  END IF;

  SELECT count(*) INTO v_classic_wrong
    FROM public.cash_games
   WHERE template_name = 'classic' AND variant IN ('plo5','plo6')
     AND COALESCE(ruleset_snapshot->>'rules_profile','') <> 'madness_without_lightning'
     AND closed_at IS NULL
     AND (ruleset_snapshot->>'vpip_floor')::int <> 40;
  IF v_classic_wrong > 0 THEN
    RAISE EXCEPTION '% live classic plo clusters did not land on 40', v_classic_wrong;
  END IF;

  SELECT count(*) INTO v_madness_moved
    FROM public.cash_games
   WHERE ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'
     AND closed_at IS NULL
     AND (ruleset_snapshot->>'vpip_floor')::int <> 50;
  IF v_madness_moved > 0 THEN
    RAISE EXCEPTION '% madness_without_lightning clusters lost their 50 floor', v_madness_moved;
  END IF;
END
$verify$;

COMMIT;
