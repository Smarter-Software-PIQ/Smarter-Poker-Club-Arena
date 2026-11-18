DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_game_floor_from_template';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'fn_cash_game_floor_from_template is missing';
  END IF;

  IF v_md5 NOT IN ('b45a0612b5c6956dfe33c632446caee9',
                   '5b0b03754daf121c77d2a451bb9f8839') THEN
    RAISE EXCEPTION 'fn_cash_game_floor_from_template drifted (md5=%), refusing', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_def   jsonb;
  v_floor integer;
  v_win   integer;
  v_grace integer;
BEGIN
  IF NEW.ruleset_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE TEMPLATE IS A PROMISE TO THE PLAYER (2026-09-09).
  v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);

  -- MADNESS WITHOUT LIGHTNING (Dan 2026-10-24).
  -- The 50% floor this branch used to pin was removed on 2026-11-17: every
  -- Classic and Madness PLO table keeps 40 now, and 40 is already the madness
  -- template's own default, so the branch supplies the rest of the madness
  -- ruleset and no longer overrides the floor.
  IF NEW.template_name = 'classic'
     AND NOT coalesce(NEW.lightning_enabled, false)
     AND NEW.variant NOT IN ('pineapple', 'pineapple_holdem')
     AND NEW.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning' THEN
    v_def := public.fn_cash_template_defaults('madness', NEW.variant);
  END IF;

  NEW.ruleset_snapshot := NEW.ruleset_snapshot
    || jsonb_build_object(
         'vpip_floor',   v_def->'vpip_floor',
         'vpip_window',  v_def->'vpip_window',
         'regular_ante', v_def->'regular_ante',
         'bombs',        v_def->'bombs',
         'min_buyin_bb', v_def->'min_buyin_bb');

  -- THE CLASSIC FLOOR (Dan 2026-11-10). A Classic cash game at or above the
  -- configured minimum big blind carries its variant's floor, a rolling
  -- window and a warning grace. GREATEST so a stronger floor already on the
  -- snapshot is preserved rather than lowered by a config row. Until
  -- 2026-11-17 that stronger floor was the 50% madness_without_lightning
  -- pinned on plo5 and plo6; every PLO table keeps 40 now, so nothing in the
  -- tree carries 50. A tournament table never reaches here: cash_games holds
  -- cash clusters only.
  IF NEW.template_name = 'classic' THEN
    SELECT fl.floor_percent, fl.window_hands, fl.warn_grace_hands
      INTO v_floor, v_win, v_grace
      FROM public.ca_classic_vpip_floors fl
     WHERE fl.variant = NEW.variant
       AND NEW.bb >= fl.min_bb
     LIMIT 1;

    IF v_floor IS NOT NULL THEN
      NEW.ruleset_snapshot := NEW.ruleset_snapshot
        || jsonb_build_object(
             'vpip_floor', GREATEST(
                             COALESCE((NEW.ruleset_snapshot->>'vpip_floor')::integer, 0),
                             v_floor),
             'vpip_window',      v_win,
             'vpip_rolling',     true,
             'vpip_grace_hands', v_grace);

      -- The floor never reaches back over hands played before it existed.
      IF (NEW.ruleset_snapshot->>'vpip_floor_since') IS NULL THEN
        NEW.ruleset_snapshot := NEW.ruleset_snapshot
          || jsonb_build_object('vpip_floor_since', to_jsonb(now()));
      END IF;
    END IF;
  END IF;

  IF NEW.variant IN ('flh','flo8') THEN
    NEW.ruleset_snapshot := NEW.ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL);
  END IF;
  RETURN NEW;
END;
$fn$;

UPDATE public.cash_games
   SET ruleset_snapshot = ruleset_snapshot || jsonb_build_object('vpip_floor', 40)
 WHERE ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'
   AND closed_at IS NULL
   AND (ruleset_snapshot->>'vpip_floor') IS DISTINCT FROM '40';

UPDATE public.tables t
   SET maintain_percent_min = 40
  FROM public.cash_games cg, public.clubs c
 WHERE cg.id = t.cluster_id
   AND c.id = t.club_id
   AND c.lifecycle_status <> 'retired'
   AND cg.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'
   AND COALESCE(t.is_deleted, false) = false
   AND t.nit_game IS TRUE
   AND t.maintain_percent_min IS DISTINCT FROM 40;

DO $verify$
DECLARE
  v_md5     text;
  v_left_50 int;
  v_madness int;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_game_floor_from_template';
  IF v_md5 <> '5b0b03754daf121c77d2a451bb9f8839' THEN
    RAISE EXCEPTION 'floor trigger post-image is %, expected 5b0b03754daf121c77d2a451bb9f8839', v_md5;
  END IF;

  SELECT count(*) INTO v_left_50
    FROM public.cash_games
   WHERE closed_at IS NULL AND (ruleset_snapshot->>'vpip_floor')::int = 50;
  IF v_left_50 > 0 THEN
    RAISE EXCEPTION '% open clusters still carry a 50 percent floor', v_left_50;
  END IF;

  SELECT count(*) INTO v_madness
    FROM public.tables t
    JOIN public.cash_games cg ON cg.id = t.cluster_id
    JOIN public.clubs c ON c.id = t.club_id
   WHERE c.lifecycle_status <> 'retired'
     AND cg.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'
     AND COALESCE(t.is_deleted,false) = false
     AND t.lifecycle = 'live' AND t.nit_game
     AND t.maintain_percent_min IS DISTINCT FROM 40;
  IF v_madness > 0 THEN
    RAISE EXCEPTION '% live madness tables did not land on 40', v_madness;
  END IF;
END
$verify$;