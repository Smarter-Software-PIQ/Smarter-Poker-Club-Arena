-- 20261124042000_harden_promo_wallet_invariants.sql
--
-- Structural hardening of Promo Chip Rules so none of the fixed vulnerabilities
-- can break or regress through any existing or future RPC:
--   1. Database-level ledger guard on public.chip_ledger (via the existing
--      BEFORE INSERT trigger zz_ca_funded_return_journal ->
--      fn_ca_funded_chip_return_journal, zero table locks): unconditionally
--      refuses any posted ledger leg leaving promo_wallet into club_treasury,
--      union_bank, credit_facility, or a non-promo union_wallet column.
--   2. Alias-safe unified 7-day downline and 24-hour agent daily promo helpers
--      matching both canonical 'promo_wallet' and alias 'cashier_promo_wallet'
--      with explicit service_role-only EXECUTE ACLs.
--
-- Function-only migration: no hot-table DDL, no data rewrites, no locks on
-- gameplay tables.
-- @live-proof: position('promo_wallet_cannot_convert_to_non_promo' in pg_get_functiondef('public.fn_ca_funded_chip_return_journal()'::regprocedure)) > 0 AND position('cashier_promo_wallet' in pg_get_functiondef('public.fn_ca_agent_promo_downline_sent_7d(uuid,uuid,timestamptz)'::regprocedure)) > 0 AND position('cashier_promo_wallet' in pg_get_functiondef('public.fn_ca_agent_promo_daily_allowance(uuid,uuid,timestamptz)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chip_ledger'::regclass AND tgname = 'zz_ca_funded_return_journal' AND NOT tgisinternal AND tgenabled <> 'D')
-- @probe-exempt: public.fn_ca_funded_chip_return_journal Trigger function cannot be invoked directly; verified by plpgsql_check and isolated PG17 ledger guard proofs.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Unbypassable DB-level Promo Conservation Guard on chip_ledger BEFORE INSERT.
--    Runs inside the existing zz_ca_funded_return_journal trigger (after
--    trg_ca_chip_ledger_enrich populates to_label) with zero table locks.
DO $harden_ledger_guard$
DECLARE
  v_sig regprocedure := 'public.fn_ca_funded_chip_return_journal()'::regprocedure;
  v_def text;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
  v_anchor constant text := $old$ IF NEW.amount>0 AND NEW.category='refund'$old$;
  v_guard constant text := $guard$ IF NEW.from_type='promo_wallet' AND NEW.amount>0 AND COALESCE(NEW.status,'posted')='posted'
    AND (NEW.to_type IN('club_treasury','union_bank','credit_facility')
         OR (NEW.to_type='union_wallet' AND NEW.to_label IS NOT NULL AND NEW.to_label<>'union_wallets.promo_wallet')) THEN
  RAISE EXCEPTION 'Promo Chips Must Return To A Promo Wallet'
    USING ERRCODE='23514', HINT='promo_wallet_cannot_convert_to_non_promo';
 END IF;
$guard$;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.chip_ledger'::regclass
       AND tgname = 'zz_ca_funded_return_journal'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'zz_ca_funded_return_journal trigger missing or disabled on chip_ledger';
  END IF;

  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;

  IF position('promo_wallet_cannot_convert_to_non_promo' in v_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_funded_chip_return_journal already carries promo conservation guard';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_funded_chip_return_journal anchor mismatch';
  END IF;

  EXECUTE replace(v_def, v_anchor, v_guard || v_anchor);

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_sig
       AND p.proacl::text IS NOT DISTINCT FROM v_acl
       AND p.proowner = v_owner
       AND p.prosecdef = v_definer
       AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN
    RAISE EXCEPTION 'fn_ca_funded_chip_return_journal metadata drifted';
  END IF;
END
$harden_ledger_guard$;

-- 2. Alias-safe unified 7-day downline promo counter with explicit ACLs.
CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_downline_sent_7d(
  p_club_id uuid,
  p_to_user_id uuid,
  p_at timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(sum(t.amount), 0)
    FROM public.chip_transactions t
   WHERE t.club_id = p_club_id
     AND t.to_user_id = p_to_user_id
     AND (
       t.transaction_type = 'promo_wallet_send'
       OR (
         t.transaction_type IN ('agent_wallet_send', 'peer_transfer')
         AND t.metadata ->> 'destination' IN ('promo_wallet', 'cashier_promo_wallet')
         AND t.from_user_id IS DISTINCT FROM t.to_user_id
       )
     )
     AND t.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
     AND t.created_at > p_at - interval '168 hours';
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_agent_promo_downline_sent_7d(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_agent_promo_downline_sent_7d(uuid, uuid, timestamptz)
  TO service_role;

-- 3. Alias-safe unified 24-hour per-agent daily promo allowance with explicit ACLs.
CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_daily_allowance(
  p_club_id uuid,
  p_agent uuid,
  p_at timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cap AS (SELECT trim_scale(round(public.fn_sp_setting('agent_promo_daily_chips', 250), 2)) AS c),
  sent AS (
    SELECT COALESCE(sum(t.amount), 0) AS s
      FROM public.chip_transactions t
     WHERE t.club_id = p_club_id AND t.from_user_id = p_agent
       AND (
         t.transaction_type = 'promo_wallet_send'
         OR (
           t.transaction_type IN ('agent_wallet_send', 'peer_transfer')
           AND t.metadata ->> 'destination' IN ('promo_wallet', 'cashier_promo_wallet')
           AND t.from_user_id IS DISTINCT FROM t.to_user_id
         )
       )
       AND t.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
       AND t.created_at > p_at - interval '24 hours')
  SELECT jsonb_build_object('limit_chips', cap.c, 'window_hours', 24,
                            'sent_last_24_hours', trim_scale(sent.s),
                            'remaining_chips', trim_scale(greatest(0::numeric, cap.c - sent.s)))
    FROM cap, sent;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_agent_promo_daily_allowance(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_agent_promo_daily_allowance(uuid, uuid, timestamptz)
  TO service_role;

-- @probe-for: public.fn_ca_agent_promo_downline_sent_7d
DO $probe$
DECLARE v numeric;
BEGIN
  v := public.fn_ca_agent_promo_downline_sent_7d(gen_random_uuid(), gen_random_uuid(), clock_timestamp());
  IF v IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe_unexpected_downline_sent_7d: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_agent_promo_daily_allowance
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_ca_agent_promo_daily_allowance(gen_random_uuid(), gen_random_uuid(), clock_timestamp());
  IF (r ->> 'limit_chips')::numeric IS NULL OR (r ->> 'sent_last_24_hours')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe_unexpected_daily_allowance: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
