-- 20261102045940_kingfish_is_exempt_from_single_device.sql
--
-- ONE ACCOUNT IS EXEMPT FROM SINGLE-ACTIVE-DEVICE: KINGFISH
--
-- Dan, 2026-11-01: his own beta-testing account KingFish
-- (daniel@bekavactrading.com) is the only account that must NOT have the
-- single-active-device restriction. KingFish may be signed in on any number
-- of devices at once, none kicking another; every other account keeps the
-- rule from migration 20261102023127.
--
-- An exempt account never kicks and is never prompted: every browser it signs
-- in on auto-enrolls as its own device and coexists. The exemption is a table
-- so it is auditable and reversible; it holds exactly KingFish today.
--
-- One transaction (CLAUDE.md DDL policy). Functions are CREATE OR REPLACE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_device_enforcement_exempt (
  user_id uuid PRIMARY KEY,
  note text,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_device_enforcement_exempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_device_enforcement_exempt FROM public, anon, authenticated, service_role;
GRANT SELECT ON public.ca_device_enforcement_exempt TO service_role;

-- KingFish (daniel@bekavactrading.com), Dan's beta-testing account.
INSERT INTO public.ca_device_enforcement_exempt(user_id, note)
  VALUES ('47965354-0e56-43ef-931c-ddaab82af765', 'KingFish - owner beta account, Dan 2026-11-01')
  ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_ca_device_enforcement_exempt(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'pg_catalog','public','pg_temp'
AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.ca_device_enforcement_exempt WHERE user_id = p_uid);
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_device_enforcement_exempt(uuid) FROM public, anon;

-- Activation: an exempt account never signs any other session out. It still
-- records the last active device and prunes dead bindings, but kicks nobody.
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

  IF NOT public.fn_ca_device_enforcement_exempt(p_uid) THEN
    DELETE FROM auth.sessions s
      WHERE s.user_id = p_uid
        AND s.id <> p_keep_session
        AND EXISTS (SELECT 1 FROM public.ca_session_bindings sb
                     WHERE sb.session_id = s.id AND sb.device_id <> p_device);
    GET DIAGNOSTICS v_kicked = ROW_COUNT;
  END IF;

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

-- Claim: an exempt account is never asked same-or-new; every unbound browser
-- auto-enrolls as its own device and coexists (activation kicks nobody).
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

  -- First device for the account, OR an exempt account (which never prompts
  -- and never kicks): auto-enroll this browser as its own device.
  IF NOT v_have_devices OR public.fn_ca_device_enforcement_exempt(v_uid) THEN
    INSERT INTO public.ca_devices(user_id,label) VALUES (v_uid,v_label) RETURNING id INTO v_dev;
    INSERT INTO public.ca_browser_bindings(browser_token,user_id,device_id) VALUES (v_bt,v_uid,v_dev);
    INSERT INTO public.ca_session_bindings(session_id,user_id,device_id,bound_at)
      VALUES (v_sid,v_uid,v_dev,v_at)
      ON CONFLICT (session_id) DO UPDATE SET device_id=excluded.device_id, bound_at=v_at;
    v_kicked := public.fn_ca_activate_device(v_uid, v_dev, v_sid);
    RETURN jsonb_build_object('ok',true,'bound',true,'first',NOT v_have_devices,'device_id',v_dev,'kicked',v_kicked);
  END IF;

  RETURN jsonb_build_object('ok',true,'needs_choice',true,
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label) ORDER BY last_active_at DESC)
                          FROM public.ca_devices WHERE user_id=v_uid), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.ca_claim_active_login(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_claim_active_login(text,text) TO authenticated, service_role;

COMMIT;
