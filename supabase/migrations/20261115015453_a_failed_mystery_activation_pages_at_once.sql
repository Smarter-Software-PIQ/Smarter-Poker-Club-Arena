-- 20261115015453_a_failed_mystery_activation_pages_at_once.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- On 2026-11-14 fn_mystery_bounty_seed raised 42883 on every call for about
-- 40 minutes (20261114072509 passed a numeric where the sealed-ladder reader
-- takes a bigint; fixed by 20261115001336). The engine wrote
-- "CRITICAL: mystery bounty seed FAILED" to its console on every sweep, and
-- that console reaches nobody: server/src/services/errorReporter.ts only
-- console.errors. Two mystery MTTs (a5957f99, a88c4be4) waited at their
-- activation point and dealt nothing. The first page came 20 minutes later,
-- from fn_ca_tournament_dark_while_running, which can only see the symptom.
--
-- Now the seed reports its own failure, the first time it happens:
--
--   * The seed's body runs inside a block that catches an unexpected error.
--     A transient refusal (class 40 rollback/deadlock, 08 connection, 53
--     resources, 57 cancel/statement timeout, 55P03 lock not available) is
--     re-raised exactly as before: the engine retries it on its next sweep and
--     nobody is paged for a busy moment. Anything else (an unresolvable call,
--     a cast, a refused trigger, the chest-count invariant) rolls the seed's
--     own work back - so nothing is half-seeded - records ONE critical
--     financial_alerts row for that tournament
--     (source fn_ca_tournament_mystery_activation_failed, which the existing
--     reliability class rule 'fn_ca_tournament%' files as tournament_lifecycle)
--     and answers {ok:false, reason:'activation_failed'}. The engine already
--     treats any refusal other than entry_still_open as "report and retry on
--     the next sweep" (TournamentManagerBase maybeActivateMysteryBounty), so its
--     behaviour is unchanged; only the page is new.
--   * The same function closes that alert on its own success path: the
--     activation that commits, or a later call that finds the stage already
--     past pending, resolves it with a note. No sweep, no detector, no repair
--     job (CLAUDE.md 10.11, 10.12): the code path that failed is the code path
--     that reports and clears.
--
-- The body edit is in place against the exact live text, pinned by md5 like
-- the earlier mystery migrations, so a different preimage refuses instead of
-- silently producing a different money function.
--
-- @live-proof: position('fn_ca_tournament_mystery_activation_failed' IN pg_get_functiondef('public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure)) > 0 AND position('fn_ca_tournament_mystery_activation_recovered' IN pg_get_functiondef('public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure)) > 0 AND to_regprocedure('public.fn_ca_tournament_mystery_activation_failed(uuid,text,text,text)') IS NOT NULL AND to_regprocedure('public.fn_ca_tournament_mystery_activation_recovered(uuid,text)') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Records the failure once per tournament while it stays open. Called only
-- from fn_mystery_bounty_seed's exception handler, after the seed's own work
-- has been rolled back to its block.
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_mystery_activation_failed(
  p_tournament_id uuid,
  p_sqlstate text,
  p_message text,
  p_context text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
BEGIN
  -- Two sweeps failing at once still file one alert.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca-mystery-activation-failed:' || p_tournament_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.financial_alerts fa
              WHERE fa.source = 'fn_ca_tournament_mystery_activation_failed'
                AND NOT fa.resolved
                AND fa.context->>'tournament_id' = p_tournament_id::text) THEN
    RETURN;
  END IF;

  SELECT t.name INTO v_name FROM public.tournaments t WHERE t.id = p_tournament_id;

  INSERT INTO public.financial_alerts (severity, source, message, context)
  VALUES (
    'critical',
    'fn_ca_tournament_mystery_activation_failed',
    format(
      'Mystery bounty activation for tournament %s (%s) failed in the database with %s: %s. '
      || 'Its chests cannot open, and an event at its activation point deals nothing until '
      || 'this error is fixed. The engine retries the same call on every sweep, so fix the '
      || 'function or schema this error names; this alert closes itself when the activation '
      || 'commits.',
      p_tournament_id, COALESCE(v_name, 'unknown'), COALESCE(p_sqlstate, '?'),
      left(COALESCE(p_message, ''), 400)),
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'tournament_name', v_name,
      'sqlstate', p_sqlstate,
      'error', left(COALESCE(p_message, ''), 1000),
      'pg_context', left(COALESCE(p_context, ''), 2000),
      'checked_at', now()));
END;
$function$;

-- Closes that alert from the seed's own success path.
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_mystery_activation_recovered(
  p_tournament_id uuid,
  p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.financial_alerts fa
     SET resolved = true,
         resolved_at = now(),
         resolution = format(
           'fn_mystery_bounty_seed found tournament %s at mystery stage %s at %s: the activation '
           || 'this alert reported has committed, so the seed closed it on its own success path.',
           p_tournament_id, COALESCE(p_stage, 'active'), now())
   WHERE fa.source = 'fn_ca_tournament_mystery_activation_failed'
     AND NOT fa.resolved
     AND fa.context->>'tournament_id' = p_tournament_id::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_mystery_activation_failed(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_mystery_activation_recovered(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- The seed: report an unexpected failure, clear it on success.
DO $seed$
DECLARE
  sig constant regprocedure := 'public.fn_mystery_bounty_seed(uuid,integer,jsonb)'::regprocedure;
  -- md5(pg_get_functiondef) of the body 20261115001336 left in production.
  preimage constant text := '16986022242d32fbda89a1e77dde67e0';
  d text;
  a0 constant text := E'  v_sealed_cents bigint;\nBEGIN\n';
  a1 constant text :=
       E'  v_sealed_cents bigint;\n'
    || E'  -- A FAILED ACTIVATION PAGES AT ONCE (2026-11-14,\n'
    || E'  -- 20261115015453_a_failed_mystery_activation_pages_at_once).\n'
    || E'  v_err_state text;\n'
    || E'  v_err_message text;\n'
    || E'  v_err_context text;\n'
    || E'BEGIN\n'
    || E'  BEGIN\n';
  b0 constant text := E'    RETURN jsonb_build_object(''ok'', true, ''already_seeded'', true,\n';
  b1 constant text :=
       E'    PERFORM public.fn_ca_tournament_mystery_activation_recovered(\n'
    || E'      p_tournament_id, v_t.mystery_bounty_stage);\n'
    || b0;
  c0 constant text :=
       E'  RETURN jsonb_build_object(''ok'', true, ''already_seeded'', false,\n'
    || E'    ''pool_cents'', v_sealed_cents, ''chests'', v_count, ''stage'', ''active'');\n'
    || E'END;\n';
  c1 constant text :=
       E'  PERFORM public.fn_ca_tournament_mystery_activation_recovered(p_tournament_id, ''active'');\n'
    || E'  RETURN jsonb_build_object(''ok'', true, ''already_seeded'', false,\n'
    || E'    ''pool_cents'', v_sealed_cents, ''chests'', v_count, ''stage'', ''active'');\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    /* The block above rolled back to its start: no chest, no stage\n'
    || E'       change. A transient refusal is re-raised exactly as before and the\n'
    || E'       engine retries it on its next sweep. Anything else would fail the\n'
    || E'       same way on every sweep while the event waits, so it pages now. */\n'
    || E'    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE,\n'
    || E'                            v_err_message = MESSAGE_TEXT,\n'
    || E'                            v_err_context = PG_EXCEPTION_CONTEXT;\n'
    || E'    IF left(v_err_state, 2) IN (''40'', ''08'', ''53'', ''57'') OR v_err_state = ''55P03'' THEN\n'
    || E'      RAISE;\n'
    || E'    END IF;\n'
    || E'    PERFORM public.fn_ca_tournament_mystery_activation_failed(\n'
    || E'      p_tournament_id, v_err_state, v_err_message, v_err_context);\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''reason'', ''activation_failed'',\n'
    || E'      ''sqlstate'', v_err_state, ''error'', left(v_err_message, 500));\n'
    || E'  END;\n'
    || E'END;\n';
  n int;
BEGIN
  d := pg_get_functiondef(sig);
  IF md5(d) <> preimage THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed is not the body this migration was written against (md5 % <> %)',
      md5(d), preimage;
  END IF;

  n := (length(d) - length(replace(d, a0, ''))) / length(a0);
  IF n <> 1 THEN RAISE EXCEPTION 'fn_mystery_bounty_seed: expected one declaration end, found %', n; END IF;
  n := (length(d) - length(replace(d, b0, ''))) / length(b0);
  IF n <> 1 THEN RAISE EXCEPTION 'fn_mystery_bounty_seed: expected one already-seeded return, found %', n; END IF;
  n := (length(d) - length(replace(d, c0, ''))) / length(c0);
  IF n <> 1 THEN RAISE EXCEPTION 'fn_mystery_bounty_seed: expected one success return, found %', n; END IF;

  d := replace(replace(replace(d, a0, a1), b0, b1), c0, c1);
  EXECUTE d;

  d := pg_get_functiondef(sig);
  IF position('fn_ca_tournament_mystery_activation_failed' IN d) = 0
     OR position('fn_ca_tournament_mystery_activation_recovered(p_tournament_id, ''active'')' IN d) = 0
     OR position('EXCEPTION WHEN OTHERS THEN' IN d) = 0 THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed: the failure report was not installed';
  END IF;
END
$seed$;

COMMIT;
