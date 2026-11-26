-- 20261126000707_heads_up_rematch_copies_follow_their_changed_sources.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- HEADS-UP REMATCH COPIES FOLLOW THEIR CHANGED SOURCES (2026-11-25).
--
-- WHAT BROKE. Every heads-up "Play Again" that both players accepted has ended
-- "unavailable" since 2026-11-20. Measured read-only on production
-- 2026-11-26 00:05 UTC, public.ca_heads_up_rematches with two acceptances:
-- 23 matched from 11-09 to 11-19, then 5 of 5 unavailable (three on 11-20,
-- two on 11-24). Nobody was charged: the refusal comes before any purchase.
--
-- WHY. 20261109021122 copies eight buy-in layers for a named payer and pins
-- the md5 of each source in public.ca_heads_up_rematch_sources. The rematch
-- core refuses when any pin no longer matches, "until a migration re-derives
-- the copies". Two sources were then replaced and nothing re-derived:
--   20261119052513 (a late registration never pauses the tournament) changed
--     public.fn_register_for_tournament: the registration lane call;
--   20261119185300 (remaining tournament row locks never block hands) changed
--     public.fn_register_for_tournament_before_atomic_capacity_20260907: the
--     tournament row is read FOR NO KEY UPDATE.
-- Both rewrote their doors from a list, in place, so neither file names a
-- rematch object, and the rematch concurrency proof runs from a fixture that
-- does not hold the production sources. Nothing could see the drift except a
-- player, and the Heads-Up Rematch Certification, which is dispatch-only and
-- failed on exactly this on 2026-11-24 23:08 UTC (run 45506954667).
--
-- THE FIX.
-- 1. The derivation that 20261109021122 ran once, from temporary helpers, is
--    now one kept procedure: smarter_private.heads_up_rematch_rederive(). It
--    reads all eight sources as they are installed, applies the same anchored
--    replacements (each anchor must occur exactly its reviewed number of
--    times, or everything is refused), installs each copy only if it reads no
--    auth.uid() and no caller session and no browser or service role can run
--    it, and then re-pins every source. The replacement text is taken from
--    20261109021122 byte for byte.
-- 2. This migration runs it. Measured read-only before writing this file: all
--    of the two changed sources' anchors still occur exactly as reviewed, and
--    the two copies change by exactly the two source changes above (the lane
--    call and the row lock) and nothing else.
-- 3. A migration that replaces a pinned source now ends with
--      PERFORM smarter_private.heads_up_rematch_rederive();   (in a DO block)
--    and tests/heads-up-rematch-copies-follow-their-sources.law.test.ts fails
--    the build when one does not.
--
-- No table lock is taken; no balance moves.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- Only the two reviewed source changes may be pending. Anything else is a
-- change nobody has read against the rematch, and is refused.
DO $pre$
DECLARE v_unreviewed text[];
BEGIN
  IF (SELECT count(*) FROM public.ca_heads_up_rematch_sources) <> 8 THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: expected 8 source layers' USING ERRCODE = '55000';
  END IF;
  SELECT array_agg(s.source ORDER BY s.source) INTO v_unreviewed
    FROM public.ca_heads_up_rematch_sources s
   WHERE md5(pg_get_functiondef(s.source::regprocedure)) IS DISTINCT FROM s.source_md5
     AND s.source NOT IN (
       'public.fn_register_for_tournament(uuid,boolean)',
       'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)');
  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: unreviewed source change in %', v_unreviewed
      USING ERRCODE = '55000';
  END IF;
END
$pre$;

-- Replace an anchor that must occur exactly p_count times, or refuse.
CREATE OR REPLACE FUNCTION smarter_private.heads_up_rematch_swap(
  p_src text, p_anchor text, p_new text, p_count integer, p_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $f$
DECLARE n integer;
BEGIN
  n := (length(p_src) - length(replace(p_src, p_anchor, ''))) / greatest(length(p_anchor), 1);
  IF n <> p_count THEN
    RAISE EXCEPTION 'heads_up_rematch_anchor_%: found % times, expected %', p_label, n, p_count
      USING ERRCODE = '55000';
  END IF;
  RETURN replace(p_src, p_anchor, p_new);
END $f$;

-- Install one copy: never a body that still reads auth.uid() or a live
-- session, and never one any browser or service role can execute.
CREATE OR REPLACE FUNCTION smarter_private.heads_up_rematch_install(p_def text, p_signature text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  IF position('auth.uid()' IN p_def) > 0 THEN
    RAISE EXCEPTION 'heads_up_rematch_copy_reads_auth_uid: %', p_signature USING ERRCODE = '55000';
  END IF;
  -- The call, not the name: a source comment explains the check by name.
  IF position('public.fn_caller_session_is_live()' IN p_def) > 0 THEN
    RAISE EXCEPTION 'heads_up_rematch_copy_reads_the_caller_session: %', p_signature USING ERRCODE = '55000';
  END IF;
  EXECUTE p_def;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p_signature);
END $f$;

-- The whole derivation, from the sources as they are installed now.
CREATE OR REPLACE FUNCTION smarter_private.heads_up_rematch_rederive()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $rederive$
DECLARE
  d text;
  r record;
  v_repinned text[] := '{}';
BEGIN
  IF (SELECT count(*) FROM public.ca_heads_up_rematch_sources) <> 8 THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: expected 8 source layers' USING ERRCODE = '55000';
  END IF;
  -- One derivation at a time. The copies and their pins commit together, so
  -- a rematch reads either the old set (refused) or the new one, never half.
  PERFORM pg_advisory_xact_lock(hashtextextended('heads-up-rematch-rederive', 0));

  -- 3a. The registration core: the payer is a parameter.
  d := pg_get_functiondef('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_atomic_capacity_20260907(p_tournament_id uuid, p_seat_first_internal boolean DEFAULT false)',
    'FUNCTION public.fn_ca_rematch_register_core_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'core_header');
  d := smarter_private.heads_up_rematch_swap(d,
    'v_uid uuid := auth.uid();',
    'v_uid uuid := p_payer; -- HEADS UP REMATCH: the consenting payer, not the caller',
    1, 'core_payer');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_register_core_for_payer(uuid,boolean,uuid)');

  -- 3b. The late-registration retry layer.
  d := pg_get_functiondef('public.fn_register_for_tournament_before_atomic_lifecycle_gate(uuid,boolean)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_atomic_lifecycle_gate(p_tournament_id uuid, p_seat_first_internal boolean DEFAULT false)',
    'FUNCTION public.fn_ca_rematch_register_lifecycle_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'lifecycle_header');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_atomic_capacity_20260907(
      p_tournament_id,p_seat_first_internal)$a$,
    $b$public.fn_ca_rematch_register_core_for_payer(
      p_tournament_id,p_seat_first_internal,p_payer)$b$,
    2, 'lifecycle_calls');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_register_lifecycle_for_payer(uuid,boolean,uuid)');

  -- 3c. The registration status gate.
  d := pg_get_functiondef('public.fn_register_for_tournament_before_maintenance_announcement_gate(uuid,boolean)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_maintenance_announcement_gate(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_maint_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'maint_header');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_atomic_lifecycle_gate(
    p_tournament_id,COALESCE(p_seat_first_internal,false))$a$,
    $b$public.fn_ca_rematch_register_lifecycle_for_payer(
    p_tournament_id,COALESCE(p_seat_first_internal,false),p_payer)$b$,
    1, 'maint_call');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_register_maint_for_payer(uuid,boolean,uuid)');

  -- 3d. The registration freeze gate.
  d := pg_get_functiondef('public.fn_register_for_tournament_before_terminal_seat_gate(uuid,boolean)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_terminal_seat_gate(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_terminal_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'terminal_header');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_maintenance_announcement_gate(
    p_tournament_id, p_seat_first_internal
  )$a$,
    $b$public.fn_ca_rematch_register_maint_for_payer(
    p_tournament_id, p_seat_first_internal, p_payer
  )$b$,
    1, 'terminal_call');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_register_terminal_for_payer(uuid,boolean,uuid)');

  -- 3e. The registration door: the payer's own seat lock and paying club.
  d := pg_get_functiondef('public.fn_register_for_tournament(uuid,boolean)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'register_header');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$  IF public.fn_caller_session_is_live() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE='28000';
  END IF;
$a$,
    $b$  -- HEADS UP REMATCH: the payer accepted through a live-session door.
$b$,
    1, 'register_session');
  d := smarter_private.heads_up_rematch_swap(d, 'auth.uid()', 'p_payer', 3, 'register_payer');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_terminal_seat_gate(
    p_tournament_id,p_seat_first_internal)$a$,
    $b$public.fn_ca_rematch_register_terminal_for_payer(
    p_tournament_id,p_seat_first_internal,p_payer)$b$,
    1, 'register_call');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_register_for_payer(uuid,boolean,uuid)');

  -- 3f. The seat purchase itself.
  d := pg_get_functiondef('public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(uuid,integer)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_seat_maint_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'seat_header');
  d := smarter_private.heads_up_rematch_swap(d,
    'v_uid        uuid := auth.uid();',
    'v_uid        uuid := p_payer; -- HEADS UP REMATCH: the consenting payer',
    1, 'seat_payer');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
$a$,
    $b$  -- HEADS UP REMATCH: the payer accepted through a live-session door.
$b$,
    1, 'seat_session');
  d := smarter_private.heads_up_rematch_swap(d,
    'public.fn_register_for_tournament(v_t.id, true)',
    'public.fn_ca_rematch_register_for_payer(v_t.id, true, v_uid)',
    1, 'seat_register');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_seat_maint_for_payer(uuid,integer,uuid)');

  -- 3g. The seat freeze gate.
  d := pg_get_functiondef('public.fn_take_seat_and_buy_in_before_terminal_seat_gate(uuid,integer)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in_before_terminal_seat_gate(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_seat_terminal_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'seat_terminal_header');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(
    p_table_id, p_seat_number
  )$a$,
    $b$public.fn_ca_rematch_seat_maint_for_payer(
    p_table_id, p_seat_number, p_payer
  )$b$,
    1, 'seat_terminal_call');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_seat_terminal_for_payer(uuid,integer,uuid)');

  -- 3h. The seat door: the payer's own seat-acquisition lock.
  d := pg_get_functiondef('public.fn_take_seat_and_buy_in(uuid,integer)'::regprocedure);
  d := smarter_private.heads_up_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_take_seat_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'door_header');
  d := smarter_private.heads_up_rematch_swap(d, 'NULL,p_table_id,auth.uid());', 'NULL,p_table_id,p_payer);', 1, 'door_payer');
  d := smarter_private.heads_up_rematch_swap(d,
    $a$public.fn_take_seat_and_buy_in_before_terminal_seat_gate(
    p_table_id,p_seat_number)$a$,
    $b$public.fn_ca_rematch_seat_terminal_for_payer(
    p_table_id,p_seat_number,p_payer)$b$,
    1, 'door_call');
  PERFORM smarter_private.heads_up_rematch_install(d, 'public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid)');

  FOR r IN SELECT s.source, s.source_md5, s.derived FROM public.ca_heads_up_rematch_sources s ORDER BY s.source LOOP
    IF to_regprocedure(r.derived) IS NULL THEN
      RAISE EXCEPTION 'heads_up_rematch_rederive: % was not installed', r.derived USING ERRCODE = '55000';
    END IF;
    IF has_function_privilege('authenticated', r.derived, 'EXECUTE')
       OR has_function_privilege('anon', r.derived, 'EXECUTE')
       OR has_function_privilege('service_role', r.derived, 'EXECUTE') THEN
      RAISE EXCEPTION 'heads_up_rematch_rederive: % is executable by a browser or service role', r.derived
        USING ERRCODE = '55000';
    END IF;
    IF position('auth.uid()' IN pg_get_functiondef(r.derived::regprocedure)) > 0 THEN
      RAISE EXCEPTION 'heads_up_rematch_rederive: % still reads auth.uid()', r.derived USING ERRCODE = '55000';
    END IF;
    IF md5(pg_get_functiondef(r.source::regprocedure)) IS DISTINCT FROM r.source_md5 THEN
      UPDATE public.ca_heads_up_rematch_sources s
         SET source_md5 = md5(pg_get_functiondef(r.source::regprocedure))
       WHERE s.source = r.source;
      v_repinned := v_repinned || r.source;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'repinned', to_jsonb(v_repinned));
END
$rederive$;

REVOKE ALL ON FUNCTION smarter_private.heads_up_rematch_swap(text, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.heads_up_rematch_install(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.heads_up_rematch_rederive() FROM PUBLIC, anon, authenticated, service_role;

DO $run$
BEGIN
  PERFORM smarter_private.heads_up_rematch_rederive();
END
$run$;

-- The copies' grants, said out loud (heads_up_rematch_install also revokes each
-- one as it installs it): no browser, no anonymous caller and no service role
-- executes a named-payer copy; only the rematch core (owner postgres) does.
REVOKE ALL ON FUNCTION public.fn_ca_rematch_register_core_for_payer(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_register_lifecycle_for_payer(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_register_maint_for_payer(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_register_terminal_for_payer(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_register_for_payer(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_seat_maint_for_payer(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_seat_terminal_for_payer(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The eight sources are NOT redefined by this file. Their names appear only as
-- replacement anchors inside heads_up_rematch_rederive, which reads them.
-- @probe-exempt: public.fn_register_for_tournament_before_atomic_capacity_20260907 is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_register_for_tournament_before_atomic_lifecycle_gate is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_register_for_tournament_before_maintenance_announcement_gate is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_register_for_tournament_before_terminal_seat_gate is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_register_for_tournament is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_take_seat_and_buy_in_before_terminal_seat_gate is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy
-- @probe-exempt: public.fn_take_seat_and_buy_in is not redefined by this file; its name is only a replacement anchor inside smarter_private.heads_up_rematch_rederive, which reads it and installs the copy

-- The two copies whose bodies changed run once before COMMIT, on the changed
-- lines: the registration lane call, and the tournament row read. An unknown
-- tournament and an unknown payer are refused by the body itself; everything
-- is undone with the subtransaction.
-- @probe-for: public.fn_ca_rematch_register_for_payer
DO $probe$
BEGIN
  PERFORM public.fn_ca_rematch_register_for_payer(gen_random_uuid(), false, gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_rematch_register_core_for_payer
DO $probe$
BEGIN
  PERFORM public.fn_ca_rematch_register_core_for_payer(gen_random_uuid(), false, gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $post$
DECLARE v_drift text[];
BEGIN
  SELECT array_agg(s.source ORDER BY s.source) INTO v_drift
    FROM public.ca_heads_up_rematch_sources s
   WHERE md5(pg_get_functiondef(s.source::regprocedure)) IS DISTINCT FROM s.source_md5;
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: still drifted after the derivation: %', v_drift
      USING ERRCODE = '55000';
  END IF;
  -- The two copies carry the two source changes they were refused for.
  IF (position('WHERE id = p_tournament_id FOR NO KEY UPDATE' IN pg_get_functiondef(
        'public.fn_ca_rematch_register_core_for_payer(uuid,boolean,uuid)'::regprocedure)) > 0)
     IS DISTINCT FROM
     (position('WHERE id = p_tournament_id FOR NO KEY UPDATE' IN pg_get_functiondef(
        'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure)) > 0)
     OR (position('fn_ca_lock_tournament_registration_acquisition' IN pg_get_functiondef(
        'public.fn_ca_rematch_register_for_payer(uuid,boolean,uuid)'::regprocedure)) > 0)
     IS DISTINCT FROM
     (position('fn_ca_lock_tournament_registration_acquisition' IN pg_get_functiondef(
        'public.fn_register_for_tournament(uuid,boolean)'::regprocedure)) > 0) THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: a copy does not follow its source' USING ERRCODE = '55000';
  END IF;
  IF has_function_privilege('authenticated', 'smarter_private.heads_up_rematch_rederive()', 'EXECUTE')
     OR has_function_privilege('anon', 'smarter_private.heads_up_rematch_rederive()', 'EXECUTE')
     OR has_function_privilege('service_role', 'smarter_private.heads_up_rematch_rederive()', 'EXECUTE') THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: the derivation is executable by a browser or service role'
      USING ERRCODE = '55000';
  END IF;
  -- Running it again changes nothing.
  IF (smarter_private.heads_up_rematch_rederive()->'repinned') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'heads_up_rematch_rederive: a second run re-pinned something' USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
