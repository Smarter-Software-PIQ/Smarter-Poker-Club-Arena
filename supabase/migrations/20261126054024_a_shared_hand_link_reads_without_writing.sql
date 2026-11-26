-- 20261126054024_a_shared_hand_link_reads_without_writing.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SHARED HAND LINK READS WITHOUT WRITING (2026-11-26, issue #9828).
--
-- WHAT BROKE. Migration 20261107021555 made fn_ca_shared_hand_open(text,
-- boolean) the one door a shared hand link opens through, granted it to anon so
-- a signed-out visitor can watch the replay, and let the same SECURITY DEFINER
-- body bump ca_shared_hands.view_count on every open. A function a caller with
-- NO ACCOUNT can execute, that runs as the owner past RLS, and that writes, is
-- the one shape the live definer-exposure audit refuses without exception
-- (scripts/ci/audit-live-definer-exposure.mjs, question 2: "anon-executable
-- writers: N (must be 0)"). It has failed every hourly and daily run since
-- 2026-11-07 on exactly this function. The build-time gate never saw it: its
-- rules only refused an anon definer that never MENTIONS auth.uid(), and this
-- body mentioned it to skip the sender's own views.
--
-- THE FIX: the read and the write are two doors.
--   fn_ca_shared_hand_open        stays the anon door, same signature, same
--                                 answers (found / revoked / payload / invite /
--                                 preview), same refusal of malformed, missing,
--                                 deleted-sender and revoked links. It is now
--                                 STABLE and writes nothing. p_count is still
--                                 accepted so every caller keeps working (the
--                                 World Hub preview page and image pass
--                                 p_count = false); it no longer does anything.
--   fn_ca_shared_hand_count_view  NEW, the only writer. Executable by
--                                 authenticated and service_role, never PUBLIC
--                                 or anon. A signed-in opener counts one view;
--                                 the sender opening their own link does not;
--                                 a revoked link or a deleted sender's link
--                                 does not. service_role may count too (no
--                                 auth.uid()), so a server that serves the link
--                                 can record a signed-out visit without anything
--                                 a browser can reach writing a row.
--
-- WHAT CHANGES FOR A PLAYER. Opening a shared hand is unchanged, signed in or
-- not. The sender's "Shared · N Views" now counts signed-in openers only: a
-- signed-out visit has no server hop in Club Arena that could record it
-- honestly, and the audit's answer for a logged-out writer is zero.
--
-- RECORDED AS A PUBLIC READER in every list that audits the anonymous surface:
-- public.ca_browser_definer_allowlist (below), reviewedAnonReaders and
-- anonPublicSurface in the same change, and docs/security/anon-executable-
-- definers.json, which already held it.
--
-- PREIMAGE. The open body is pinned to the live production definition
-- (md5 0971ecf7c8f564972a89e824a5a887e0, read 2026-11-26); anything else
-- refuses, unless the reader is already installed.
--
-- @live-proof: (SELECT p.provolatile = 's' AND pg_get_functiondef(p.oid) !~* '(^|[^a-z_])(insert into|update |delete from)' AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_ca_shared_hand_count_view(text)'::regprocedure, 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_ca_shared_hand_count_view(text)'::regprocedure, 'EXECUTE') FROM pg_proc p WHERE p.oid = 'public.fn_ca_shared_hand_open(text,boolean)'::regprocedure)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ── Preimage guard against the live production definition ──────────────────
DO $guard$
DECLARE
  v_oid oid := to_regprocedure('public.fn_ca_shared_hand_open(text,boolean)');
  v_def text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'SHARED_HAND_OPEN_PREIMAGE_DRIFT fn_ca_shared_hand_open is not installed';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) = '0971ecf7c8f564972a89e824a5a887e0' THEN
    RETURN;
  END IF;
  -- Already the reader (a re-run): STABLE and no write in its body.
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) = 's'
     AND v_def !~* '(^|[^a-z_])(insert into|update |delete from)' THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'SHARED_HAND_OPEN_PREIMAGE_DRIFT fn_ca_shared_hand_open md5 %', md5(v_def);
END $guard$;

-- ── 1. The anon door reads, and only reads ─────────────────────────────────
-- Its body must never contain the words the audit reads as a write, comments
-- included: the audit matches pg_get_functiondef text.
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_open(p_token text, p_count boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_row     public.ca_shared_hands%ROWTYPE;
  v_status  text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-HJ-NP-Za-km-z2-9]{8}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_row FROM public.ca_shared_hands WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT status INTO v_status FROM public.profiles WHERE id = v_row.sender_id;
  IF v_status IS NULL OR v_status = 'deleted' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('found', true, 'revoked', true);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'revoked', false,
    'payload', v_row.payload,
    'invite', v_row.invite_code,
    'preview', v_row.preview
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_ca_shared_hand_open(text, boolean) IS
  'Short shared-hand link reader (smarter.poker/h/<token>), executable by anon. STABLE and writes nothing (migration 20261126054024, issue #9828): payload, invite and preview of one explicitly shared hand; {found:false} for a malformed, missing or deleted-sender token; {found:true,revoked:true} with no hand for a revoked one. p_count is accepted for existing callers and ignored; views are recorded by fn_ca_shared_hand_count_view.';

REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_open(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_open(text, boolean) TO anon, authenticated, service_role;

-- It no longer names auth.uid(), so the live telemetry-exposure sweep
-- (fn_ca_browser_reachable_telemetry) sees a browser-reachable definer that
-- never asks who is calling. That is the decision, written down where that
-- sweep reads it, as the table/Lightning/tournament share previews did.
INSERT INTO public.ca_browser_definer_allowlist(proname, reason) VALUES
  (
    'fn_ca_shared_hand_open',
    'Public short shared-hand link reader (smarter.poker/h/<token>): one 8-character random token, minted only by the authenticated sender, in; that one explicitly shared hand replay payload, the sender''s invite code and preview facts out. Malformed, missing and deleted-sender tokens answer {found:false}; revoked links answer {found:true,revoked:true} with no hand. STABLE, writes nothing, cannot enumerate (migration 20261126054024).'
  )
ON CONFLICT (proname) DO NOTHING;

-- ── 2. The only writer: a signed-in opener (or the server) counts a view ───
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_count_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-HJ-NP-Za-km-z2-9]{8}$' THEN
    RETURN jsonb_build_object('counted', false);
  END IF;
  -- The sender looking at their own link is not a view; nor is a revoked link
  -- or a deleted sender's link, which the reader refuses to open.
  UPDATE public.ca_shared_hands h
     SET view_count = h.view_count + 1, last_viewed_at = now()
   WHERE h.token = p_token
     AND h.revoked_at IS NULL
     AND h.sender_id IS DISTINCT FROM v_uid
     AND EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.id = h.sender_id AND pr.status IS NOT NULL AND pr.status <> 'deleted'
     );
  RETURN jsonb_build_object('counted', FOUND);
END;
$function$;

COMMENT ON FUNCTION public.fn_ca_shared_hand_count_view(text) IS
  'Counts one view of a short shared-hand link (migration 20261126054024, issue #9828). The only writer of ca_shared_hands.view_count: authenticated and service_role only, never PUBLIC or anon. Refuses a caller with neither auth.uid() nor the service role; skips the sender''s own opens, revoked links and deleted senders. Returns {counted:boolean}.';

REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_count_view(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_count_view(text) TO authenticated, service_role;

-- ── 3. Install-time assertions ──────────────────────────────────────────────
DO $post$
DECLARE
  v_open  oid := 'public.fn_ca_shared_hand_open(text,boolean)'::regprocedure;
  v_count oid := 'public.fn_ca_shared_hand_count_view(text)'::regprocedure;
  v_bad   text;
BEGIN
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_open) <> 's' THEN
    RAISE EXCEPTION 'SHARED_HAND_POST fn_ca_shared_hand_open is not STABLE';
  END IF;
  IF pg_get_functiondef(v_open) ~* '(^|[^a-z_])(insert into|update |delete from)' THEN
    RAISE EXCEPTION 'SHARED_HAND_POST fn_ca_shared_hand_open still writes';
  END IF;
  IF NOT has_function_privilege('anon', v_open, 'EXECUTE') THEN
    RAISE EXCEPTION 'SHARED_HAND_POST a signed-out visitor can no longer open a shared hand';
  END IF;
  IF has_function_privilege('anon', v_count, 'EXECUTE') THEN
    RAISE EXCEPTION 'SHARED_HAND_POST anon can execute fn_ca_shared_hand_count_view';
  END IF;
  IF NOT has_function_privilege('authenticated', v_count, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_count, 'EXECUTE') THEN
    RAISE EXCEPTION 'SHARED_HAND_POST fn_ca_shared_hand_count_view lost its signed-in grant';
  END IF;
  -- The live audit's question 2, asked of every shared-hand door: nothing a
  -- caller with no account can execute writes.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname LIKE 'fn\_ca\_shared\_hand\_%'
     AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND pg_get_functiondef(p.oid) ~* '(^|[^a-z_])(insert into|update |delete from)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SHARED_HAND_POST anon can execute a shared-hand writer: %', v_bad;
  END IF;
END $post$;

-- @probe-for: public.fn_ca_shared_hand_open
DO $probe$
BEGIN
  PERFORM public.fn_ca_shared_hand_open('AbCd2345', false);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_shared_hand_count_view
DO $probe$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.fn_ca_shared_hand_count_view('AbCd2345');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
