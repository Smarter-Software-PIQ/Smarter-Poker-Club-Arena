-- @live-proof: (md5(pg_get_functiondef('smarter_private.spin_owner_command_receipt_is_immutable()'::regprocedure))='c27a7108c6ecf68daefc3c2601382a9d' AND md5(pg_get_functiondef('fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)'::regprocedure))='456095e8d088c638a5a73d3dfd5081b3' AND has_function_privilege('service_role','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_table_privilege('service_role','smarter_private.spin_owner_command_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND EXISTS(SELECT 1 FROM pg_class WHERE oid='smarter_private.spin_owner_command_receipts'::regclass AND relrowsecurity) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.spin_owner_command_receipts'::regclass AND tgname='spin_owner_command_receipt_is_immutable' AND tgenabled='O') AND EXISTS(SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_spin_owner_command' AND status='approved'))
-- 20261101024022_spin_owner_commands_retain_their_original_request_receipt.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
-- The HTTP client already sends a UUID, but the old route discarded it. A
-- delayed activation after an intervening deactivation could fund the pool
-- again; a delayed deactivation could switch off a newer activation. Retain
-- the exact original request/result with the unchanged financial transaction,
-- verify current authorization on replay, and reject identity/payload reuse.
-- No new retry, financial rule, seed refund, engine operation or player hold.
-- Rollback: revert the route first; revoke EXECUTE on fn_spin_owner_command
-- through a new qualified protected migration. Retain receipts permanently.
-- Never restore the unkeyed route while ambiguous requests remain outstanding.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $preimage$ BEGIN
  IF md5(pg_get_functiondef('public.fn_spin_activate(uuid,numeric,numeric,text,uuid)'::regprocedure)) IS DISTINCT FROM '05a8ad6cc740da6add15819d185e8c91' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_activate(uuid,numeric,numeric,text,uuid)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_deactivate(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'f6ec890914a09729178f7e7eb6a909de' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_deactivate(uuid,uuid)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_move_owner_wallet(uuid,text,text,numeric)'::regprocedure)) IS DISTINCT FROM '1cbfcf55f0abf1475f76d2861b96b71e' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_move_owner_wallet(uuid,text,text,numeric)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_owner_kind(uuid)'::regprocedure)) IS DISTINCT FROM 'da7ca584fafe6bf8a128994c568c70cc' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_owner_kind(uuid)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_required_seed(numeric)'::regprocedure)) IS DISTINCT FROM '9f9d5dd9d72dd078a49d4096a6fe71f2' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_required_seed(numeric)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_reserve_owner(uuid)'::regprocedure)) IS DISTINCT FROM '6c28a9dbb936d147b30ca543c573d5eb' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_reserve_owner(uuid)'; END IF;
  IF md5(pg_get_functiondef('public.fn_spin_reserve_pool(uuid)'::regprocedure)) IS DISTINCT FROM 'd3596faa39ba012e437d769386f8a057' THEN RAISE EXCEPTION 'spin_owner_command_financial_owner_changed: fn_spin_reserve_pool(uuid)'; END IF;
END $preimage$;

INSERT INTO public.ca_money_rpc_registry(proname,status,notes)
VALUES ('fn_spin_owner_command','approved','Service-only currently authorized Spin owner command; request receipt and unchanged canonical wallet transaction commit together')
ON CONFLICT(proname) DO NOTHING;
DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_spin_owner_command' AND status='approved') THEN
    RAISE EXCEPTION 'spin_owner_command_money_authority_not_approved' USING ERRCODE='42501';
  END IF;
END $guard$;

-- A request receipt and its existing financial transaction commit together.
-- No foreign keys to hot owner/wallet rows: these immutable identities are
-- historical evidence, not a new lifetime constraint on a club or account.
CREATE TABLE smarter_private.spin_owner_command_receipts (
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, request_id)
);
ALTER TABLE smarter_private.spin_owner_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.spin_owner_command_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.spin_owner_command_receipt_is_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'spin_owner_command_receipt_is_immutable' USING ERRCODE = '55000';
END;
$fn$;
CREATE TRIGGER spin_owner_command_receipt_is_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON smarter_private.spin_owner_command_receipts
FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.spin_owner_command_receipt_is_immutable();
REVOKE ALL ON FUNCTION smarter_private.spin_owner_command_receipt_is_immutable() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_spin_owner_command(
  p_request_id uuid, p_club_id uuid, p_owner_id uuid, p_actor uuid,
  p_action text, p_seed_amount numeric DEFAULT NULL,
  p_offered_max_stake numeric DEFAULT NULL, p_source_wallet text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, smarter_private
AS $fn$
DECLARE
  v_club public.clubs%ROWTYPE;
  v_owner uuid;
  v_union boolean;
  v_admin boolean;
  v_lead boolean;
  v_request jsonb;
  v_previous smarter_private.spin_owner_command_receipts%ROWTYPE;
  v_response jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'spin_owner_command_service_only' USING ERRCODE = '42501';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'spin_owner_command_requires_read_committed' USING ERRCODE = '25000';
  END IF;
  IF p_request_id IS NULL OR p_club_id IS NULL OR p_owner_id IS NULL OR p_actor IS NULL
     OR p_action IS NULL OR p_action NOT IN ('activate', 'deactivate') THEN
    RAISE EXCEPTION 'spin_owner_command_invalid_identity' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'activate' THEN
    IF p_seed_amount IS NULL OR p_seed_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_seed_amount < 0 OR p_seed_amount <> trunc(p_seed_amount)
       OR p_offered_max_stake IS NULL
       OR p_offered_max_stake NOT IN (1, 2, 3, 5, 10, 20, 50, 100)
       OR p_source_wallet IS NULL THEN
      RAISE EXCEPTION 'spin_owner_command_invalid_activation' USING ERRCODE = '22023';
    END IF;
  ELSIF p_seed_amount IS NOT NULL OR p_offered_max_stake IS NOT NULL OR p_source_wallet IS NOT NULL THEN
    RAISE EXCEPTION 'spin_owner_command_invalid_deactivation' USING ERRCODE = '22023';
  END IF;

  -- The actor/request pair is global across owners and actions. Reusing it
  -- with another payload is a conflict, never a fresh financial instruction.
  PERFORM pg_advisory_xact_lock(hashtextextended('spin-owner-command:' || p_actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'spin_owner_command_club_missing' USING ERRCODE = '22023'; END IF;
  v_owner := coalesce(v_club.union_id, v_club.id);
  SELECT v_club.union_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.unions WHERE id = v_owner) INTO v_union;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role IN ('admin','superadmin')) INTO v_admin;
  SELECT EXISTS (SELECT 1 FROM public.union_admins WHERE union_id = v_owner AND user_id = p_actor AND role = 'union_lead') INTO v_lead;
  IF v_owner IS DISTINCT FROM p_owner_id OR (v_admin OR (v_union AND v_lead) OR (NOT v_union AND v_club.owner_id = p_actor)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'spin_owner_command_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Existing financial owners lock the pool before the owner wallet. Keep
  -- that order, then pin the live club mapping and current permission rows.
  SELECT * INTO v_previous FROM smarter_private.spin_owner_command_receipts
    WHERE actor_id = p_actor AND request_id = p_request_id;
  IF NOT FOUND THEN
    IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'spin_owner_command_platform_frozen' USING ERRCODE = '55000';
    END IF;
    PERFORM public.fn_spin_reserve_pool(p_club_id);
  END IF;
  PERFORM 1 FROM public.spin_bonus_pools WHERE club_id = v_owner FOR UPDATE;
  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id FOR UPDATE;
  PERFORM 1 FROM public.profiles WHERE id = p_actor FOR SHARE;
  PERFORM 1 FROM public.union_admins WHERE union_id = v_owner AND user_id = p_actor FOR SHARE;
  IF coalesce(v_club.union_id, v_club.id) IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'spin_owner_command_owner_changed' USING ERRCODE = '55000';
  END IF;
  SELECT v_club.union_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.unions WHERE id = v_owner) INTO v_union;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role IN ('admin','superadmin')) INTO v_admin;
  SELECT EXISTS (SELECT 1 FROM public.union_admins WHERE union_id = v_owner AND user_id = p_actor AND role = 'union_lead') INTO v_lead;
  IF (v_admin OR (v_union AND v_lead) OR (NOT v_union AND v_club.owner_id = p_actor)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'spin_owner_command_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'activate' AND NOT (
    (v_union AND p_source_wallet IN ('chip_balance','promo_wallet','rake_wallet','spin_reserve_wallet'))
    OR (NOT v_union AND p_source_wallet IN ('chip_treasury','promo_balance'))
  ) THEN RAISE EXCEPTION 'spin_owner_command_invalid_wallet' USING ERRCODE = '22023'; END IF;

  v_request := jsonb_build_object('club_id', p_club_id, 'owner_id', p_owner_id,
    'action', p_action, 'seed_amount', p_seed_amount,
    'offered_max_stake', p_offered_max_stake, 'source_wallet', p_source_wallet);
  SELECT * INTO v_previous FROM smarter_private.spin_owner_command_receipts
    WHERE actor_id = p_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.owner_id IS DISTINCT FROM p_owner_id OR v_previous.request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'spin_owner_command_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_previous.response;
  END IF;
  IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'spin_owner_command_platform_frozen' USING ERRCODE = '55000';
  END IF;
  IF p_action = 'activate' THEN
    v_response := public.fn_spin_activate(p_club_id, p_seed_amount, p_offered_max_stake, p_source_wallet, p_actor);
  ELSE
    v_response := public.fn_spin_deactivate(p_club_id, p_actor);
  END IF;
  IF jsonb_typeof(v_response) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_response->'ok') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'spin_owner_command_invalid_result' USING ERRCODE = '55000';
  END IF;
  INSERT INTO smarter_private.spin_owner_command_receipts(actor_id, request_id, owner_id, request, response)
    VALUES (p_actor, p_request_id, p_owner_id, v_request, v_response);
  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text) TO service_role;

DO $postimage$ BEGIN IF NOT (md5(pg_get_functiondef('smarter_private.spin_owner_command_receipt_is_immutable()'::regprocedure))='c27a7108c6ecf68daefc3c2601382a9d' AND md5(pg_get_functiondef('fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)'::regprocedure))='456095e8d088c638a5a73d3dfd5081b3' AND has_function_privilege('service_role','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_spin_owner_command(uuid,uuid,uuid,uuid,text,numeric,numeric,text)','EXECUTE') AND NOT has_table_privilege('service_role','smarter_private.spin_owner_command_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND EXISTS(SELECT 1 FROM pg_class WHERE oid='smarter_private.spin_owner_command_receipts'::regclass AND relrowsecurity) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.spin_owner_command_receipts'::regclass AND tgname='spin_owner_command_receipt_is_immutable' AND tgenabled='O') AND EXISTS(SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_spin_owner_command' AND status='approved')) THEN RAISE EXCEPTION 'spin_owner_command_postimage_mismatch';END IF;END $postimage$;

COMMIT;
