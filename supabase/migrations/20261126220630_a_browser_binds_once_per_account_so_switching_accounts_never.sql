-- 20261126220630_a_browser_binds_once_per_account_so_switching_accounts_never.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A BROWSER BINDS ONCE PER ACCOUNT, SO SWITCHING ACCOUNTS NEVER COLLIDES
--
-- WHAT BROKE. ca_browser_bindings was keyed on browser_token alone, but every
-- reader looks a binding up by (browser_token, user_id). One browser that
-- signs in to two accounts (Dan's Mac: Danimal, then KingFish) therefore found
-- no binding for the second account and tried to INSERT the same browser_token
-- again: duplicate key value violates unique constraint
-- "ca_browser_bindings_pkey", 134 refusals in 24 h (2026-11-25/26), every one
-- from two browser tokens bound to Danimal while KingFish signed in. The
-- client treats a refused claim as a transport failure and retries on the
-- next auth event, so the second account was never bound on that browser and
-- the refusal repeated all day. ca_register_new_device had the same insert
-- and refused the same way when a non-exempt second account chose "new
-- device".
--
-- THE FIX. The identity of a binding is (browser_token, user_id), which is
-- what ca_claim_active_login, ca_register_new_device, ca_list_devices and
-- ca_resolve_pairing already read and what ca_pairing_requests already keys
-- on. The primary key now says so. Each account keeps its own binding of a
-- shared browser, so switching back to the first account is still recognised
-- (no same-or-new prompt) and neither account's binding is overwritten. Every
-- writer conflicts on the natural key, so a repeated claim is idempotent.
-- Existing rows are unique on browser_token, hence unique on the pair: the
-- constraint swap rewrites nothing.
--
-- Function bodies are the LIVE definitions (pg_get_functiondef, 2026-11-26)
-- with only the binding writes changed; CREATE OR REPLACE keeps their grants.
-- ca_browser_bindings is touched only at sign-in (9.5k rows), not a hot
-- relation, so the brief ACCESS EXCLUSIVE needs no daily-maintenance window.
--
-- One transaction (CLAUDE.md production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.ca_browser_bindings
  DROP CONSTRAINT ca_browser_bindings_pkey,
  ADD CONSTRAINT ca_browser_bindings_pkey PRIMARY KEY (browser_token, user_id);

CREATE OR REPLACE FUNCTION public.ca_claim_active_login(p_device_id text DEFAULT NULL::text, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid := public.fn_ca_live_session_id();
  v_bt text := nullif(p_device_id,'');
  v_dev uuid; v_label text; v_kicked int := 0; v_have_devices boolean;
  v_at timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'why','no_user'); END IF;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'why','session_gone',
      'superseded', EXISTS (SELECT 1 FROM public.ca_active_device a
        JOIN public.ca_session_bindings sb ON sb.user_id=a.user_id AND sb.device_id=a.device_id
        JOIN auth.sessions s ON s.id=sb.session_id
        WHERE a.user_id=v_uid AND (s.not_after IS NULL OR s.not_after>v_at)));
  END IF;
  IF v_bt IS NULL THEN RETURN jsonb_build_object('ok',false,'why','no_browser_token'); END IF;

  v_label := left(coalesce(nullif(btrim(p_label),''),'This Device'), 60);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 731));

  SELECT device_id INTO v_dev FROM public.ca_browser_bindings
    WHERE browser_token = v_bt AND user_id = v_uid;

  IF v_dev IS NOT NULL THEN
    UPDATE public.ca_browser_bindings SET last_seen=v_at
      WHERE browser_token=v_bt AND user_id=v_uid;
    INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
      VALUES (v_sid,v_uid,v_dev,v_at)
      ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
    v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
    RETURN jsonb_build_object('ok',true,'bound',true,'device_id',v_dev,'kicked',v_kicked);
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.ca_devices WHERE user_id=v_uid) INTO v_have_devices;

  -- First device for the account, OR an exempt account (which never prompts
  -- and never kicks): auto-enroll this browser as its own device.
  IF NOT v_have_devices OR public.fn_ca_device_enforcement_exempt(v_uid) THEN
    INSERT INTO public.ca_devices(user_id,label) VALUES (v_uid,v_label) RETURNING id INTO v_dev;
    -- Keyed per account: another account's binding of this same browser is
    -- neither a conflict nor overwritten.
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id) VALUES (v_bt,v_uid,v_dev)
      ON CONFLICT (browser_token,user_id) DO UPDATE SET device_id=excluded.device_id, last_seen=v_at;
    INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
      VALUES (v_sid,v_uid,v_dev,v_at)
      ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
    v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
    RETURN jsonb_build_object('ok',true,'bound',true,'first',NOT v_have_devices,'device_id',v_dev,'kicked',v_kicked);
  END IF;

  RETURN jsonb_build_object('ok',true,'needs_choice',true,
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label) ORDER BY last_active_at DESC)
                          FROM public.ca_devices WHERE user_id=v_uid), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.ca_register_new_device(p_device_id text, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid := public.fn_ca_live_session_id();
  v_bt text := nullif(p_device_id,'');
  v_dev uuid; v_label text; v_kicked int; v_at timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL OR v_sid IS NULL THEN RETURN jsonb_build_object('ok',false,'why','session_gone'); END IF;
  IF v_bt IS NULL THEN RETURN jsonb_build_object('ok',false,'why','no_browser_token'); END IF;
  v_label := left(coalesce(nullif(btrim(p_label),''),'New Device'), 60);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 731));

  SELECT device_id INTO v_dev FROM public.ca_browser_bindings WHERE browser_token=v_bt AND user_id=v_uid;
  IF v_dev IS NULL THEN
    INSERT INTO public.ca_devices(user_id,label) VALUES (v_uid,v_label) RETURNING id INTO v_dev;
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id) VALUES (v_bt,v_uid,v_dev)
      ON CONFLICT (browser_token,user_id) DO UPDATE SET device_id=excluded.device_id, last_seen=v_at;
  END IF;
  INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
    VALUES (v_sid,v_uid,v_dev,v_at)
    ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
  v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
  RETURN jsonb_build_object('ok',true,'device_id',v_dev,'kicked',v_kicked);
END $function$;

CREATE OR REPLACE FUNCTION public.ca_resolve_pairing(p_request_id uuid, p_approve boolean, p_caller_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid := public.fn_ca_live_session_id();
  v_caller text := nullif(p_caller_device_id,'');
  v_caller_dev uuid; r public.ca_pairing_requests;
BEGIN
  IF v_uid IS NULL OR v_sid IS NULL THEN RETURN jsonb_build_object('ok',false,'why','session_gone'); END IF;
  SELECT device_id INTO v_caller_dev FROM public.ca_browser_bindings WHERE browser_token=v_caller AND user_id=v_uid;
  IF v_caller_dev IS NULL THEN RETURN jsonb_build_object('ok',false,'why','caller_not_enrolled'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 731));
  SELECT * INTO r FROM public.ca_pairing_requests WHERE id=p_request_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'why','not_pending'); END IF;
  IF r.target_device_id <> v_caller_dev THEN RETURN jsonb_build_object('ok',false,'why','not_authorized_device'); END IF;

  IF p_approve THEN
    -- Binds the requesting browser for THIS account only; another account's
    -- binding of the same browser is left as it is.
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id)
      VALUES (r.browser_token,v_uid,r.target_device_id)
      ON CONFLICT (browser_token,user_id) DO UPDATE SET device_id=excluded.device_id, last_seen=now();
    UPDATE public.ca_pairing_requests SET status='approved', resolved_at=now() WHERE id=p_request_id;
    RETURN jsonb_build_object('ok',true,'approved',true,'device_id',r.target_device_id);
  ELSE
    UPDATE public.ca_pairing_requests SET status='denied', resolved_at=now() WHERE id=p_request_id;
    RETURN jsonb_build_object('ok',true,'approved',false);
  END IF;
END $function$;

-- The probes run each new body once as a signed-in caller whose session is not
-- live (the migration has no session of its own), so each returns session_gone
-- after reading auth.sessions; plpgsql_check covers the enrolled paths. The
-- first probe also proves the new key: one browser holds a row per account, and
-- the writers' conflict target finds its own row instead of the other account's.

-- @probe-for: public.ca_claim_active_login
DO $probe$
DECLARE r jsonb; n int;
BEGIN
  INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id)
    VALUES ('probe-browser', gen_random_uuid(), gen_random_uuid()),
           ('probe-browser', gen_random_uuid(), gen_random_uuid());
  INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id)
    SELECT browser_token, user_id, gen_random_uuid() FROM public.ca_browser_bindings
     WHERE browser_token = 'probe-browser'
    ON CONFLICT (browser_token,user_id) DO UPDATE SET device_id=excluded.device_id, last_seen=clock_timestamp();
  SELECT count(*) INTO n FROM public.ca_browser_bindings WHERE browser_token = 'probe-browser';
  IF n <> 2 THEN RAISE EXCEPTION 'probe: one browser should hold two account bindings, found %', n; END IF;

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  r := public.ca_claim_active_login('probe-browser', 'Probe');
  IF r->>'why' IS DISTINCT FROM 'session_gone' THEN RAISE EXCEPTION 'probe: claim answered %', r; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.ca_register_new_device
DO $probe$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  r := public.ca_register_new_device('probe-browser', 'Probe');
  IF r->>'why' IS DISTINCT FROM 'session_gone' THEN RAISE EXCEPTION 'probe: register answered %', r; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.ca_resolve_pairing
DO $probe$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  r := public.ca_resolve_pairing(gen_random_uuid(), true, 'probe-browser');
  IF r->>'why' IS DISTINCT FROM 'session_gone' THEN RAISE EXCEPTION 'probe: resolve answered %', r; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
