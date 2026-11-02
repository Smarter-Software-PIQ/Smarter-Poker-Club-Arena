-- 20261102134711_certification_accounts_get_a_short_audited_test_vip_grant.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-02 approved a test VIP grant ("APPROVE TEST VIP GRANT") after
-- the supported certification route proved it could create isolated reserved
-- accounts and fund them from a certification club's own opening grant, but
-- had NO way to give a reserved account an active VIP without minting
-- diamonds or taking a real payment. VIP-only behavior (rabbit hunting a
-- previous hand) could therefore not be certified live.
--
-- public.fn_ca_certification_vip_grant(user, minutes, operator, reason, op_id)
--   - service role only;
--   - only a reserved post-deploy certification identity
--     (auth email ca-customization-cert-postdeploy-%@example.invalid, not
--     deleted, a fixture account by fn_ca_is_fixture_account, profile role
--     'user', not admin, not a horse);
--   - never overrides a real entitlement: refuses an account that is VIP now,
--     is lifetime, or has any active VIP subscription;
--   - 1 to 180 minutes; the profile carries vip_expires_at = now() + minutes,
--     which is exactly what the engine and fn_consume_rabbit_hunt_v2 read, so
--     the grant lapses by itself;
--   - no diamonds, no payment, no ledger money moves;
--   - one open grant per account; a repeated op_id replays the recorded grant.
-- public.fn_ca_certification_vip_end(user, op_id, reason) ends that grant
--   early (cleanup), only while the profile still carries the grant's exact
--   expiry, and is idempotent.
-- Every grant and end is recorded in ca_certification_vip_grants, which
-- cannot be deleted and whose grant facts cannot be rewritten.
--
-- @live-proof: has_function_privilege('service_role','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_certification_vip_end(uuid,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_certification_vip_end(uuid,text,text)','EXECUTE') AND NOT has_table_privilege('authenticated','public.ca_certification_vip_grants','SELECT')

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_certification_vip_grants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  op_id         text        NOT NULL UNIQUE CHECK (length(btrim(op_id)) > 0),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  operator      text        NOT NULL CHECK (length(btrim(operator)) > 0),
  reason        text        NOT NULL CHECK (length(btrim(reason)) >= 20),
  ended_at      timestamptz,
  end_reason    text,
  CONSTRAINT ca_certification_vip_grants_window CHECK (
    expires_at > granted_at AND expires_at <= granted_at + interval '180 minutes'),
  CONSTRAINT ca_certification_vip_grants_end CHECK (
    (ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND length(btrim(end_reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS ca_certification_vip_grants_one_open
  ON public.ca_certification_vip_grants (user_id) WHERE ended_at IS NULL;

COMMENT ON TABLE public.ca_certification_vip_grants IS
  'Audit of short test VIP grants to reserved certification accounts (fn_ca_certification_vip_grant / _end). Rows are never deleted; only ended_at/end_reason may be set, once.';

ALTER TABLE public.ca_certification_vip_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_certification_vip_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_certification_vip_grants TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_certification_vip_grants_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ca_certification_vip_grants rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.op_id IS DISTINCT FROM OLD.op_id OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.operator IS DISTINCT FROM OLD.operator
     OR NEW.reason IS DISTINCT FROM OLD.reason OR OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'a certification VIP grant is recorded once and ended once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS ca_certification_vip_grants_guard ON public.ca_certification_vip_grants;
CREATE TRIGGER ca_certification_vip_grants_guard
  BEFORE UPDATE OR DELETE ON public.ca_certification_vip_grants
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_certification_vip_grants_guard();

CREATE OR REPLACE FUNCTION public.fn_ca_certification_vip_grant(
  p_user_id  uuid,
  p_minutes  integer,
  p_operator text,
  p_reason   text,
  p_op_id    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prior   public.ca_certification_vip_grants%ROWTYPE;
  v_email   text;
  v_deleted timestamptz;
  v_profile record;
  v_expires timestamptz;
  v_row     public.ca_certification_vip_grants%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_ca_certification_vip_grant is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR length(btrim(COALESCE(p_op_id, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_and_op_id_required');
  END IF;
  IF length(btrim(COALESCE(p_operator, ''))) = 0 OR length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_and_reason_required');
  END IF;
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 180 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'minutes_must_be_1_to_180');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ca_certification_vip:' || p_user_id::text, 0));

  SELECT * INTO v_prior FROM public.ca_certification_vip_grants WHERE op_id = btrim(p_op_id);
  IF FOUND THEN
    IF v_prior.user_id IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'op_id_belongs_to_another_grant');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'grant_id', v_prior.id,
      'expires_at', v_prior.expires_at, 'ended_at', v_prior.ended_at);
  END IF;

  SELECT u.email, u.deleted_at INTO v_email, v_deleted FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR v_deleted IS NOT NULL
     OR v_email IS NULL OR v_email NOT LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     OR NOT COALESCE(public.fn_ca_is_fixture_account(p_user_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_reserved_certification_account');
  END IF;

  SELECT p.role, p.is_admin, p.is_horse, p.is_vip, p.vip_tier, p.vip_expires_at
    INTO v_profile FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_profile.role, '') <> 'user'
     OR COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_horse, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_reserved_certification_account');
  END IF;
  IF COALESCE(v_profile.vip_tier, '') = 'lifetime'
     OR (COALESCE(v_profile.is_vip, false)
         AND (v_profile.vip_expires_at IS NULL OR v_profile.vip_expires_at > now()))
     OR EXISTS (SELECT 1 FROM public.vip_subscriptions s
                 WHERE s.user_id = p_user_id
                   AND s.status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_already_has_a_vip_entitlement');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_certification_vip_grants g
              WHERE g.user_id = p_user_id AND g.ended_at IS NULL AND g.expires_at > now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'an_open_grant_exists');
  END IF;

  -- A lapsed earlier grant is closed on record before the new one opens.
  UPDATE public.ca_certification_vip_grants
     SET ended_at = now(), end_reason = 'lapsed'
   WHERE user_id = p_user_id AND ended_at IS NULL;

  v_expires := now() + make_interval(mins => p_minutes);
  UPDATE public.profiles
     SET is_vip = true, vip_tier = 'monthly', vip_expires_at = v_expires
   WHERE id = p_user_id;

  INSERT INTO public.ca_certification_vip_grants (user_id, op_id, expires_at, operator, reason)
  VALUES (p_user_id, btrim(p_op_id), v_expires, btrim(p_operator), btrim(p_reason))
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'grant_id', v_row.id,
    'granted_at', v_row.granted_at, 'expires_at', v_row.expires_at);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_certification_vip_end(
  p_user_id uuid,
  p_op_id   text,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_grant public.ca_certification_vip_grants%ROWTYPE;
  v_now   timestamptz := now();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_ca_certification_vip_end is service-role only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reason_required');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ca_certification_vip:' || p_user_id::text, 0));
  SELECT * INTO v_grant FROM public.ca_certification_vip_grants
   WHERE op_id = btrim(COALESCE(p_op_id, '')) AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_grant');
  END IF;
  IF v_grant.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'ended_at', v_grant.ended_at);
  END IF;
  -- Only the grant's own entitlement is withdrawn: the profile must still carry
  -- exactly the expiry this grant wrote.
  UPDATE public.profiles
     SET is_vip = false, vip_tier = NULL, vip_expires_at = LEAST(v_now, v_grant.expires_at)
   WHERE id = p_user_id AND vip_tier = 'monthly' AND vip_expires_at = v_grant.expires_at;
  UPDATE public.ca_certification_vip_grants
     SET ended_at = v_now, end_reason = btrim(p_reason)
   WHERE id = v_grant.id;
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'ended_at', v_now);
END
$function$;

COMMENT ON FUNCTION public.fn_ca_certification_vip_grant(uuid, integer, text, text, text) IS
  'Service role only: a 1-180 minute VIP for a reserved certification account (ca-customization-cert-postdeploy-%@example.invalid), never over a real entitlement, no diamonds or payment, audited in ca_certification_vip_grants.';
COMMENT ON FUNCTION public.fn_ca_certification_vip_end(uuid, text, text) IS
  'Service role only: ends a certification VIP grant early (cleanup), idempotent, withdrawing only the grant''s own entitlement.';

REVOKE ALL ON FUNCTION public.fn_ca_certification_vip_grant(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_certification_vip_end(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_certification_vip_grants_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_certification_vip_grant(uuid, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_certification_vip_end(uuid, text, text) TO service_role;

COMMIT;
