CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_def jsonb;
BEGIN
  IF NEW.ruleset_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE TEMPLATE IS A PROMISE TO THE PLAYER (2026-09-09). The four fields the
  -- lobby blurb names come from fn_cash_template_defaults on EVERY write, not
  -- only at creation. "No Antes, No Bombs, No VPIP Floor" cannot be true of a
  -- game whose snapshot says otherwise, whoever wrote that snapshot.
  --
  -- `||` and not jsonb_set for `bombs`: the object is replaced WHOLE, so a
  -- stale member inside it (a trigger left over from a template change) cannot
  -- survive underneath a corrected `enabled`.
  v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);

  -- MADNESS WITHOUT LIGHTNING (Dan 2026-10-24). One named profile, honoured
  -- only on an ordinary Classic game that is not Lightning: the Madness
  -- promise (BB ante, two-board bombs every 10 minutes) with the owner's 50%
  -- floor. It is still the template that decides, on every write.
  IF NEW.template_name = 'classic'
     AND NOT coalesce(NEW.lightning_enabled, false)
     AND NEW.variant NOT IN ('pineapple', 'pineapple_holdem')
     AND NEW.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning' THEN
    v_def := public.fn_cash_template_defaults('madness', NEW.variant)
             || jsonb_build_object('vpip_floor', 50);
  END IF;

  NEW.ruleset_snapshot := NEW.ruleset_snapshot
    || jsonb_build_object(
         'vpip_floor',   v_def->'vpip_floor',
         'vpip_window',  v_def->'vpip_window',
         'regular_ante', v_def->'regular_ante',
         'bombs',        v_def->'bombs');

  RETURN NEW;
END;
$function$
