-- 20261102023127_device_pairing_physical_device_identity.sql
--
-- A PHYSICAL DEVICE IS WHAT THE USER ENROLLS, NOT WHAT A HEADER CLAIMS
--
-- Dan, 2026-11-01: "Platform class identifies a device category, not a
-- physical device: two separate Macs or two iPhones would coexist. Browser
-- platform headers also do not establish an unforgeable device identity."
--
-- THE CONSTRAINT. Web browsers are sandboxed from one another: Chrome and
-- Safari on one Mac cannot share any identifier, and no request header (IP,
-- user agent, platform) is an unforgeable per-machine identity. So "these two
-- browsers are the same physical device" can only be asserted by the user,
-- once, and proven by someone already signed in ON that device.
--
-- THE MODEL. Every browser install carries a stable random token (its
-- localStorage ca_device_id; a native install uses the OS device id). Tokens
-- are grouped into ca_devices - the physical devices the user controls. One
-- device is active at a time: activating it signs out sessions bound to any
-- OTHER device, while every browser bound to the SAME device coexists. A new
-- browser joins an existing device only by APPROVAL from a browser already
-- signed in on it (ca_pairing_requests, delivered over realtime), which a
-- different physical device cannot give; or the user calls it a new device,
-- which signs the others out. Identity is the enrolled token, never the user
-- agent, so an iPad in desktop mode is still its own browser token on its own
-- physical device and kicks correctly.
--
-- ROLLOUT. ca_claim_active_login keeps its name and its p_device_id argument
-- (now the browser token) so an old cached client keeps working - its browser
-- stays unbound, neither kicked nor kicking - and gains an optional p_label.
-- The old ca_account_active_login/ca_login_sessions path is replaced.
--
-- One transaction (CLAUDE.md DDL policy).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_devices_user ON public.ca_devices (user_id);

CREATE TABLE IF NOT EXISTS public.ca_browser_bindings (
  browser_token text PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_browser_bindings_device ON public.ca_browser_bindings (device_id);

CREATE TABLE IF NOT EXISTS public.ca_session_bindings (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_session_bindings_user ON public.ca_session_bindings (user_id);

CREATE TABLE IF NOT EXISTS public.ca_active_device (
  user_id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ca_pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  browser_token text NOT NULL,
  label text,
  target_device_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT ca_pairing_status_ck CHECK (status IN ('pending','approved','denied','expired'))
);
CREATE INDEX IF NOT EXISTS idx_ca_pairing_requests_user ON public.ca_pairing_requests (user_id, status);

ALTER TABLE public.ca_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_browser_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_session_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_active_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_pairing_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ca_devices, public.ca_browser_bindings, public.ca_session_bindings,
  public.ca_active_device, public.ca_pairing_requests FROM public, anon, authenticated, service_role;
GRANT SELECT ON public.ca_devices TO service_role;
GRANT SELECT ON public.ca_browser_bindings TO service_role;
GRANT SELECT ON public.ca_session_bindings TO service_role;
GRANT SELECT ON public.ca_active_device TO service_role;
GRANT SELECT ON public.ca_pairing_requests TO service_role;
GRANT SELECT ON public.ca_pairing_requests TO authenticated;
GRANT SELECT ON public.ca_devices TO authenticated;

DROP POLICY IF EXISTS ca_pairing_own_select ON public.ca_pairing_requests;
CREATE POLICY ca_pairing_own_select ON public.ca_pairing_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS ca_devices_own_select ON public.ca_devices;
CREATE POLICY ca_devices_own_select ON public.ca_devices
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ca_pairing_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ca_pairing_requests;
    END IF;
  END IF;
END $pub$;

DROP FUNCTION IF EXISTS public.ca_claim_active_login(text);
DROP TABLE IF EXISTS public.ca_login_sessions;

CREATE OR REPLACE FUNCTION public.fn_ca_live_session_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_sid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  BEGIN v_sid := nullif(auth.jwt()->>'session_id','')::uuid; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id=v_sid AND user_id=v_uid
                   AND (not_after IS NULL OR not_after > clock_timestamp())) THEN
    RETURN NULL;
  END IF;
  RETURN v_sid;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_live_session_id() FROM public, anon;

CREATE OR REPLACE FUNCTION public.fn_ca_activate_device(p_uid uuid, p_device uuid, p_keep_session uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
DECLARE v_kicked int := 0; v_at timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.ca_active_device(user_id, device_id, activated_at)
    VALUES (p_uid, p_device, v_at)
    ON CONFLICT (user_id) DO UPDATE SET device_id=excluded.device_id, activated_at=v_at;
  UPDATE public.ca_devices SET last_active_at=v_at WHERE id=p_device;

  DELETE FROM auth.sessions s
    WHERE s.user_id = p_uid
      AND s.id <> p_keep_session
      AND EXISTS (SELECT 1 FROM public.ca_session_bindings sb
                   WHERE sb.session_id = s.id AND sb.device_id <> p_device);
  GET DIAGNOSTICS v_kicked = ROW_COUNT;

  DELETE FROM public.ca_session_bindings sb
    WHERE sb.user_id = p_uid
      AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = sb.session_id);

  IF v_kicked > 0 THEN
    INSERT INTO public.ca_player_session_revocations(user_id, revoked_before, op_id)
      VALUES (p_uid, v_at, 'device_login:' || p_device::text)
      ON CONFLICT (user_id) DO UPDATE
        SET revoked_before=excluded.revoked_before, op_id=excluded.op_id, updated_at=now();
  END IF;
  RETURN v_kicked;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_activate_device(uuid,uuid,uuid) FROM public, anon;

CREATE OR REPLACE FUNCTION public.ca_claim_active_login(p_device_id text DEFAULT NULL, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
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
    UPDATE public.ca_browser_bindings SET last_seen=v_at WHERE browser_token=v_bt;
    INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
      VALUES (v_sid,v_uid,v_dev,v_at)
      ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
    v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
    RETURN jsonb_build_object('ok',true,'bound',true,'device_id',v_dev,'kicked',v_kicked);
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.ca_devices WHERE user_id=v_uid) INTO v_have_devices;

  IF NOT v_have_devices THEN
    INSERT INTO public.ca_devices(user_id,label) VALUES (v_uid,v_label) RETURNING id INTO v_dev;
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id) VALUES (v_bt,v_uid,v_dev);
    INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
      VALUES (v_sid,v_uid,v_dev,v_at)
      ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
    v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
    RETURN jsonb_build_object('ok',true,'bound',true,'first',true,'device_id',v_dev,'kicked',v_kicked);
  END IF;

  RETURN jsonb_build_object('ok',true,'needs_choice',true,
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label) ORDER BY last_active_at DESC)
                          FROM public.ca_devices WHERE user_id=v_uid), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.ca_claim_active_login(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_claim_active_login(text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_register_new_device(p_device_id text, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
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
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id) VALUES (v_bt,v_uid,v_dev);
  END IF;
  INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
    VALUES (v_sid,v_uid,v_dev,v_at)
    ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
  v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
  RETURN jsonb_build_object('ok',true,'device_id',v_dev,'kicked',v_kicked);
END $fn$;
REVOKE ALL ON FUNCTION public.ca_register_new_device(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_register_new_device(text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_request_pairing(p_device_id text, p_target_device_id uuid, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid := public.fn_ca_live_session_id();
  v_bt text := nullif(p_device_id,'');
  v_req uuid; v_label text;
BEGIN
  IF v_uid IS NULL OR v_sid IS NULL THEN RETURN jsonb_build_object('ok',false,'why','session_gone'); END IF;
  IF v_bt IS NULL THEN RETURN jsonb_build_object('ok',false,'why','no_browser_token'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_devices WHERE id=p_target_device_id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('ok',false,'why','unknown_device');
  END IF;
  v_label := left(coalesce(nullif(btrim(p_label),''),'A New Browser'), 60);
  UPDATE public.ca_pairing_requests SET status='expired', resolved_at=now()
    WHERE user_id=v_uid AND browser_token=v_bt AND status='pending';
  INSERT INTO public.ca_pairing_requests(user_id,browser_token,label,target_device_id)
    VALUES (v_uid,v_bt,v_label,p_target_device_id) RETURNING id INTO v_req;
  RETURN jsonb_build_object('ok',true,'request_id',v_req);
END $fn$;
REVOKE ALL ON FUNCTION public.ca_request_pairing(text,uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_request_pairing(text,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_resolve_pairing(p_request_id uuid, p_approve boolean, p_caller_device_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
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
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id)
      VALUES (r.browser_token,v_uid,r.target_device_id)
      ON CONFLICT (browser_token) DO UPDATE SET device_id=excluded.device_id, user_id=excluded.user_id, last_seen=now();
    UPDATE public.ca_pairing_requests SET status='approved', resolved_at=now() WHERE id=p_request_id;
    RETURN jsonb_build_object('ok',true,'approved',true,'device_id',r.target_device_id);
  ELSE
    UPDATE public.ca_pairing_requests SET status='denied', resolved_at=now() WHERE id=p_request_id;
    RETURN jsonb_build_object('ok',true,'approved',false);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ca_resolve_pairing(uuid,boolean,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_resolve_pairing(uuid,boolean,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_list_devices(p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','auth','public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_bt text := nullif(p_device_id,''); v_mine uuid; v_active uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'why','no_user'); END IF;
  SELECT device_id INTO v_mine FROM public.ca_browser_bindings WHERE browser_token=v_bt AND user_id=v_uid;
  SELECT device_id INTO v_active FROM public.ca_active_device WHERE user_id=v_uid;
  RETURN jsonb_build_object('ok',true,'active_device_id',v_active,'my_device_id',v_mine,
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,'label',d.label,'created_at',d.created_at,'last_active_at',d.last_active_at,
        'browsers',(SELECT count(*) FROM public.ca_browser_bindings b WHERE b.device_id=d.id))
       ORDER BY d.last_active_at DESC) FROM public.ca_devices d WHERE d.user_id=v_uid),'[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.ca_list_devices(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_list_devices(text) TO authenticated, service_role;

COMMIT;
