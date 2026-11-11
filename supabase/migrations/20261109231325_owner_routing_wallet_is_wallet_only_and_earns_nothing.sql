-- @live-proof: (SELECT pg_get_constraintdef(c.oid) LIKE '%wallet_only%' FROM pg_constraint c WHERE c.conrelid='public.agents'::regclass AND c.conname='agents_status_check')
-- @live-proof: (SELECT to_regprocedure('smarter_private.ensure_owner_routing_wallet(uuid)') IS NOT NULL AND NOT has_function_privilege('anon','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE'))
-- @live-proof: (SELECT count(*)=1 FROM pg_trigger WHERE tgrelid='public.agents'::regclass AND tgname='zz_owner_routing_wallet_guard' AND NOT tgisinternal)
-- @live-proof: (SELECT pg_get_functiondef('public.fn_ca_agent_payables(uuid)'::regprocedure) LIKE '%AND coalesce(a.status, ''active'') <> ''wallet_only''%')
-- @live-proof: (SELECT pg_get_functiondef('public.get_club_agents(uuid)'::regprocedure) LIKE '%AND COALESCE(a.status, ''active'') <> ''wallet_only''%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_club_opening_checklist_complete(uuid)'::regprocedure) LIKE '%AND lower(COALESCE(a.status,''active''))<>''wallet_only''%')
-- 20261109231325_owner_routing_wallet_is_wallet_only_and_earns_nothing.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner-approved weekly rakeback cascade, 2026-11-09)
--
-- The cascade pays a club owner's direct players out of the OWNER'S AGENT
-- WALLET: club bank -> owner agent wallet -> players. An owner who has no
-- agents row has no agent wallet, and the only existing way to get one,
-- fn_ensure_agent_row, mints an ACTIVE row at the union minimum commission
-- (0.20 today). An active row is an earning agreement: fn_accounting_agent_terms_at
-- honours it, fn_player_rakeback_rate treats the owner's players as agent
-- players, and the owner becomes a commission tier. Funding a wallet must not
-- do that. Deep Stack Society's owner has no row today and must keep earning
-- exactly what an owner with no row earns.
--
-- So this adds a row that is ONLY a wallet:
--
--   1. agents.status admits 'wallet_only'.
--   2. agents_wallet_only_earns_nothing: a wallet_only row has commission_rate
--      0, player_rakeback_rate 0, no parent, no credit line, prepaid. Declared
--      as a CHECK, so no writer of any kind can give it a rate.
--   3. fn_enforce_agent_commission_bounds (replaced from the installed body,
--      md5 3e4f5df422b121391cc40f711ae5b5ee, one added exemption): the union
--      band says what an EARNING agent may be paid; a wallet_only row is
--      forbidden to earn, exactly like the co-owner/admin rows the function
--      already exempts. Only status 'wallet_only' at rate 0 is exempted, not
--      every non-active row: a suspended row keeps a real rate that the band
--      must still judge when somebody edits it.
--   4. zz_owner_routing_wallet_guard (new BEFORE trigger, named to run after
--      zz_guard_agent_agreement so it judges the final values):
--        - a wallet_only row is INSERTED only for the club's current owner and
--          opens empty;
--        - no existing row is ever CONVERTED to wallet_only (that would erase
--          an agreement somebody holds);
--        - a row is never ACTIVATED at commission 0 for a non-staff member of
--          a union club whose minimum is above 0. This is how "wallet_only can
--          only become active with a real agreement" is enforced: the
--          supported workflows (fn_club_set_member_role, fn_admin_update_agent)
--          activate and set the rate in the same UPDATE, and a real rate
--          passes; a bare status flip, directly or by way of suspended, does
--          not. It is the union band's own minimum applied at the one moment
--          the band trigger does not look (it fires on a rate change only).
--          Read on production 2026-11-09: 184 agents rows, 0 non-active
--          zero-rate non-staff rows in a union club, so this refuses nothing
--          that exists today.
--        - wallet_only -> suspended/frozen stays allowed, because account
--          deletion (fn_ca_deleted_account_leaves_every_club) suspends every
--          agents row of the person and must never be blocked by this one.
--   5. smarter_private.ensure_owner_routing_wallet(p_club_id) returns the
--      owner's agents.id. Any existing row, of any status, is returned
--      untouched. Otherwise it inserts the wallet_only row. EXECUTE is held by
--      the owner role only, the same ACL as
--      smarter_private.weekly_payout_fund_agent_shortfalls, which is the one
--      caller.
--
--   6. A wallet is not an agent, so no server response lists or counts it as
--      one. Three installed readers return every agents row of a club without
--      reading its status, and each is replaced from its installed body with
--      one added exclusion (status <> 'wallet_only'), nothing else:
--        - fn_ca_agent_payables (md5 5b86542b4686a504209767ac9a70e1e8), the
--          Payouts tab: the row list and the 'agents' count. The client
--          refuses a status outside active/suspended/frozen and requires the
--          row count to equal the 'agents' figure, so one wallet_only row
--          would have failed the whole tab for that club;
--        - get_club_agents (md5 7c4fc71f953f809d1d4e40780c747ac0), the agent
--          list;
--        - fn_club_opening_checklist_complete (md5
--          0e51fff026d1e37b1c143bbfb1fe021f): its "first-agent" step counted
--          any agents row, so a routing wallet would have satisfied "appoint
--          your first agent" with no agent appointed.
--      For a club with no wallet_only row all three answer exactly as before.
--      The wallet's BALANCE stays visible where money is read: every wallet
--      and inventory reader takes the row by (club_id, user_id) with no
--      status filter (fn_cashier_recipient_wallet_balances,
--      fn_cashier_conservation_report, fn_club_wallet_claim_back).
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE. Every reader that decides earnings,
-- permissions or reports filters on status = 'active' and so already ignores
-- the row (fn_accounting_agent_terms_at, fn_accounting_earning_contract,
-- fn_player_rakeback_rate, is_club_agent, fn_my_agent_roles,
-- fn_cashier_member_is_active, fn_union_agent_coverage,
-- fn_union_weekly_agent_statements, fn_ca_rake_by_agent). Every money path
-- that moves the wallet reads the row by (club_id, user_id) with no status
-- filter and so already works on it (fn_club_bank_send_core_20261004,
-- fn_club_wallet_claim_back, fn_ca_deleted_wallet_bank_return, round 3).
-- Proved on the installed definitions by
-- scripts/ci/test-owner-routing-wallet-postgres.py.
--
-- NO ROW IS WRITTEN HERE. A wallet is created by the funding step, the first
-- time a club needs one.
--
-- HOW IT INSTALLS (changed 2026-11-11). This file first declared the daily
-- maintenance window. It was never installed: from 2026-11-04 to 2026-11-11
-- the daily preparation that runs the window installer ran it once (refused
-- on 2026-11-10), and on 2026-11-11 the reserved preparation stopped with
-- "Release controls changed during reservation". public.agents is not one of
-- the three hot tables the window rule names (clubs, tables, hand_history),
-- so it installs at merge through Apply Merged Migration like any ordinary
-- file: one transaction, one attempt, lock_timeout 1 s below, under the
-- applier's 12 s transaction bound. ALTER TABLE public.agents takes ACCESS
-- EXCLUSIVE; the functions are created first and the table is altered last,
-- so the lock is held only for the constraint swap (184 rows to validate) and
-- one CREATE TRIGGER. If the lock is not granted within 1 s the whole file
-- rolls back and nothing is half installed. 20261109231855 (the funding
-- cascade) refuses to install until this file's
-- smarter_private.ensure_owner_routing_wallet exists.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_enforce_agent_commission_bounds()'::regprocedure))
       IS DISTINCT FROM '3e4f5df422b121391cc40f711ae5b5ee' THEN
    RAISE EXCEPTION 'owner_routing_wallet_preimage_changed: fn_enforce_agent_commission_bounds';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_agent_payables(uuid)'::regprocedure))
       IS DISTINCT FROM '5b86542b4686a504209767ac9a70e1e8' THEN
    RAISE EXCEPTION 'owner_routing_wallet_preimage_changed: fn_ca_agent_payables';
  END IF;
  IF md5(pg_get_functiondef('public.get_club_agents(uuid)'::regprocedure))
       IS DISTINCT FROM '7c4fc71f953f809d1d4e40780c747ac0' THEN
    RAISE EXCEPTION 'owner_routing_wallet_preimage_changed: get_club_agents';
  END IF;
  IF md5(pg_get_functiondef('public.fn_club_opening_checklist_complete(uuid)'::regprocedure))
       IS DISTINCT FROM '0e51fff026d1e37b1c143bbfb1fe021f' THEN
    RAISE EXCEPTION 'owner_routing_wallet_preimage_changed: fn_club_opening_checklist_complete';
  END IF;
  IF to_regprocedure('smarter_private.ensure_owner_routing_wallet(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_guard_owner_routing_wallet()') IS NOT NULL THEN
    RAISE EXCEPTION 'owner_routing_wallet_already_installed';
  END IF;
END
$guard$;

-- 3. The band exempts the one row that is forbidden to earn. Installed body
--    with a single added block (marked).
CREATE OR REPLACE FUNCTION public.fn_enforce_agent_commission_bounds()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_union uuid; v_min numeric; v_max numeric; v_rate numeric;
BEGIN
  IF NEW.commission_rate IS NULL THEN RETURN NEW; END IF;

  -- THE RATE IS NOT CHANGING, SO THERE IS NOTHING TO JUDGE.
  -- This trigger is BEFORE UPDATE OF commission_rate, and Postgres fires that
  -- for any UPDATE whose SET list names the column, identical value or not.
  -- Without this, an unrelated write - a status change, a demotion, a parent
  -- reassignment - re-validates a rate nobody touched against a band the row
  -- may never have satisfied, and raises P0001 into a caller that has no idea
  -- why. It is how demoting a co-owner to player failed outright in any club
  -- under a union with a non-zero minimum.
  IF TG_OP = 'UPDATE' AND NEW.commission_rate IS NOT DISTINCT FROM OLD.commission_rate THEN
    RETURN NEW;
  END IF;

  -- A co-owner and an admin earn nothing, by Dan's rule and by
  -- trg_agents_staff_earn_no_rakeback, which sets both of their rates to zero.
  -- The union band says what an EARNING agent may be paid, so it has nothing to
  -- say about a row that is forbidden to earn.
  IF NEW.commission_rate = 0 AND EXISTS (
    SELECT 1 FROM public.club_members cm
     WHERE cm.club_id = NEW.club_id
       AND cm.user_id = NEW.user_id
       AND cm.role IN ('co_owner', 'admin')
  ) THEN
    RETURN NEW;
  END IF;

  -- THE OWNER ROUTING WALLET (owner, 2026-11-09). A wallet_only row is a
  -- wallet and nothing else: agents_wallet_only_earns_nothing holds its rates
  -- at zero and no earning reader honours its status. It is forbidden to earn
  -- in the same way, so the band has nothing to say about it either.
  IF NEW.commission_rate = 0 AND NEW.status = 'wallet_only' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(uc.union_id, c.union_id) INTO v_union
    FROM clubs c LEFT JOIN union_clubs uc ON uc.club_id = c.id
   WHERE c.id = NEW.club_id LIMIT 1;

  IF v_union IS NULL THEN RETURN NEW; END IF;   -- standalone club: no policy

  v_min := public.fn_union_setting(v_union, 'min_agent_commission', 0);
  v_max := public.fn_union_setting(v_union, 'max_agent_commission', 1);

  -- Rates may be expressed as a fraction (0.5) or whole percent (50).
  v_rate := CASE WHEN NEW.commission_rate > 1 THEN NEW.commission_rate / 100.0
                 ELSE NEW.commission_rate END;

  IF v_rate < v_min OR v_rate > v_max THEN
    RAISE EXCEPTION 'agent commission % is outside the union policy band (% .. %)',
      v_rate, v_min, v_max
      USING HINT = 'Change unions.settings.min_agent_commission / max_agent_commission to widen the band.';
  END IF;

  RETURN NEW;
END $function$;

-- 4. Who may hold a wallet_only row, and how a row becomes active.
CREATE FUNCTION public.fn_guard_owner_routing_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_union uuid; v_min numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'wallet_only' THEN
      IF NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id = NEW.club_id AND c.owner_id = NEW.user_id) THEN
        RAISE EXCEPTION 'owner_routing_wallet_owner_only' USING ERRCODE = '23514';
      END IF;
      IF COALESCE(NEW.agent_wallet_balance, 0) <> 0
         OR COALESCE(NEW.promo_wallet_balance, 0) <> 0
         OR COALESCE(NEW.business_balance, 0) <> 0
         OR COALESCE(NEW.promo_balance, 0) <> 0 THEN
        RAISE EXCEPTION 'owner_routing_wallet_opens_empty' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'wallet_only' AND OLD.status IS DISTINCT FROM 'wallet_only' THEN
    RAISE EXCEPTION 'owner_routing_wallet_never_replaces_an_agreement' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active'
     AND COALESCE(NEW.commission_rate, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM public.club_members cm
                      WHERE cm.club_id = NEW.club_id AND cm.user_id = NEW.user_id
                        AND cm.role IN ('co_owner', 'admin')) THEN
    SELECT COALESCE(uc.union_id, c.union_id) INTO v_union
      FROM public.clubs c LEFT JOIN public.union_clubs uc ON uc.club_id = c.id
     WHERE c.id = NEW.club_id LIMIT 1;
    IF v_union IS NOT NULL THEN
      v_min := public.fn_union_setting(v_union, 'min_agent_commission', 0);
      IF COALESCE(v_min, 0) > 0 THEN
        RAISE EXCEPTION 'agent_activation_requires_an_agreement: commission 0 is below the union minimum %', v_min
          USING ERRCODE = '23514',
                HINT = 'Activate the agent through the role or agent screen with a commission rate inside the union band.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_owner_routing_wallet() FROM PUBLIC, anon, authenticated, service_role;

-- 5. The only creator of a wallet_only row.
CREATE FUNCTION smarter_private.ensure_owner_routing_wallet(p_club_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner uuid; v_id uuid;
BEGIN
  -- No EXECUTE for anon, authenticated or service_role: the weekly payout
  -- runner (owner role) is the only caller, so there is no caller to judge.
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'owner_routing_wallet_club_required' USING ERRCODE = '22023';
  END IF;
  SELECT c.owner_id INTO v_owner FROM public.clubs c WHERE c.id = p_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner_routing_wallet_club_not_found: %', p_club_id USING ERRCODE = 'P0002';
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner_routing_wallet_club_has_no_owner: %', p_club_id USING ERRCODE = '23514';
  END IF;

  -- Any row the owner already holds is the wallet, whatever its status and
  -- rate. It is returned as it stands: this function never edits an agreement.
  SELECT a.id INTO v_id FROM public.agents a
   WHERE a.club_id = p_club_id AND a.user_id = v_owner;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- 'super_agent' is what fn_ensure_agent_row stores for a wallet holder who
  -- is not an agent tier (agents_role_check admits the three tiers only).
  -- zz_guard_agent_agreement serialises this insert on the club's agreement
  -- lock; a concurrent creator wins the unique key and its row is returned.
  INSERT INTO public.agents (user_id, club_id, role, status,
                             agent_wallet_balance, promo_wallet_balance,
                             commission_rate, player_rakeback_rate,
                             credit_limit, credit_used, is_prepaid)
  VALUES (v_owner, p_club_id, 'super_agent', 'wallet_only', 0, 0, 0, 0, 0, 0, true)
  ON CONFLICT (club_id, user_id) DO NOTHING;

  SELECT a.id INTO STRICT v_id FROM public.agents a
   WHERE a.club_id = p_club_id AND a.user_id = v_owner;
  RETURN v_id;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.ensure_owner_routing_wallet(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION smarter_private.ensure_owner_routing_wallet(uuid) IS
  'Returns the club owner''s agents.id, creating a wallet_only row (commission 0, player rakeback 0, no entitlement) when the owner has none. Never alters an existing row. Called by the weekly payout funding step only.';

-- 6. A wallet is not an agent: three readers that return every agents row of
--    a club leave the routing wallet out. Each is its installed body with one
--    added exclusion; privileges and ownership are kept by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.fn_ca_agent_payables(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows      jsonb;
  v_owed      numeric;
  v_count     bigint;
  v_agents    integer;
  v_oldest    timestamptz;
  v_checked   timestamptz;
  -- 500, up from 200: the read comes off the rollup now and costs the same
  -- at any size. Only 32 agents exist at this club today.
  v_cap constant integer := 500;
BEGIN
  IF NOT fn_ca_can_manage_agents(p_club_id) THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT a.id,
           a.user_id,
           a.role,
           coalesce(a.status, 'active') AS status,
           coalesce(a.is_prepaid, false) AS is_prepaid,
           coalesce(a.credit_limit, 0)   AS credit_limit,
           coalesce(a.credit_used, 0)    AS credit_used,
           coalesce(a.commission_rate, 0) AS commission_rate,
           coalesce(a.player_rakeback_rate, 0) AS player_rakeback_rate,
           coalesce(a.total_players, 0)  AS total_players,
           coalesce(o.owed, 0)           AS owed,
           coalesce(o.rows_behind, 0)    AS rows_behind,
           o.oldest_unsettled            AS oldest,
           o.updated_at                  AS checked,
           coalesce(
             nullif(btrim(pr.display_name), ''),
             nullif(btrim(pr.alias), ''),
             nullif(btrim(pr.username), ''),
             'Member') AS name,
           row_number() OVER (ORDER BY coalesce(o.owed, 0) DESC, a.created_at) AS rn
      FROM agents a
      LEFT JOIN agent_commission_unsettled_rollup o
             ON o.club_id = p_club_id AND o.user_id = a.user_id
      LEFT JOIN profiles pr ON pr.id = a.user_id
     WHERE a.club_id = p_club_id
       -- An owner routing wallet is a wallet, not an agent (20261109231325).
       AND coalesce(a.status, 'active') <> 'wallet_only'
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'agent_id', r.id,
        'user_id', r.user_id,
        'name', r.name,
        'role', r.role,
        'status', r.status,
        'is_prepaid', r.is_prepaid,
        'credit_limit', r.credit_limit,
        'credit_used', r.credit_used,
        'credit_available', greatest(r.credit_limit - r.credit_used, 0),
        'utilization', CASE WHEN r.credit_limit > 0
                            THEN round(r.credit_used / r.credit_limit, 4)
                            ELSE 0 END,
        'commission_rate', r.commission_rate,
        'player_rakeback_rate', r.player_rakeback_rate,
        'total_players', r.total_players,
        'owed', round(r.owed, 2),
        'rows_behind', r.rows_behind,
        'oldest_unsettled', r.oldest)
      ORDER BY r.rn) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb),
    count(*)::integer,
    round(sum(r.owed), 2),
    sum(r.rows_behind),
    min(r.oldest),
    max(r.checked)
    INTO v_rows, v_agents, v_owed, v_count, v_oldest, v_checked
  FROM ranked r;

  RETURN jsonb_build_object(
    'agents', coalesce(v_agents, 0),
    'cap', v_cap,
    'total_owed', coalesce(v_owed, 0),
    'total_rows', coalesce(v_count, 0),
    'oldest_unsettled', v_oldest,
    'rollup_checked_at', v_checked,
    'rows', v_rows,
    'generated_at', now());
END;
$function$;

-- CREATE OR REPLACE keeps the installed privileges. Production holds EXECUTE
-- for authenticated and service_role only (read 2026-11-09:
-- {postgres=X,authenticated=X,service_role=X}); this restates that anon and
-- PUBLIC hold none, and changes nothing there. The function itself refuses a
-- caller who cannot manage the club's agents (fn_ca_can_manage_agents).
REVOKE ALL ON FUNCTION public.fn_ca_agent_payables(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_club_agents(p_club_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, club_id uuid, role text, status text, commission_rate numeric, player_rakeback_rate numeric, credit_limit numeric, total_players integer, lifetime_earnings numeric, display_name text, avatar_url text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.user_id,
        a.club_id,
        a.role,
        a.status,
        a.commission_rate,
        a.player_rakeback_rate,
        a.credit_limit,
        a.total_players,
        a.lifetime_earnings,
        COALESCE(p.display_name, p.username, 'Unknown') as display_name,
        p.avatar_url,
        a.created_at as joined_at
    FROM agents a
    LEFT JOIN profiles p ON a.user_id = p.id
    WHERE a.club_id = p_club_id
      -- An owner routing wallet is a wallet, not an agent (20261109231325).
      AND COALESCE(a.status, 'active') <> 'wallet_only'
    ORDER BY a.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_club_opening_checklist_complete(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club public.clubs%ROWTYPE;
  v_row public.club_opening_checklists%ROWTYPE;
  v_skipped text[] := '{}'::text[];
  v_unfinished text[] := '{}'::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign In To Finish The Opening Checklist' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_club FROM public.clubs c WHERE c.id=p_club_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club Not Found' USING ERRCODE='P0002'; END IF;
  IF v_club.owner_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Only The Club Owner Can Finish The Opening Checklist' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.club_opening_checklists k WHERE k.club_id=p_club_id FOR UPDATE;
  IF FOUND AND v_row.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('clubId',p_club_id,'completedAt',v_row.completed_at,'skippedTaskIds',to_jsonb(v_row.skipped_task_ids));
  END IF;
  IF NOT COALESCE(public.fn_club_opening_checklist_eligible(p_club_id),false) THEN RAISE EXCEPTION 'This Club Has No Opening Checklist' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.club_opening_setups s WHERE s.club_id=p_club_id) THEN RAISE EXCEPTION 'Complete The Opening Setup Wizard First' USING ERRCODE='55000'; END IF;
  v_skipped:=COALESCE(v_row.skipped_task_ids,'{}'::text[]);
  IF NOT('identity'=ANY(v_skipped)) AND NOT(
    (NULLIF(btrim(COALESCE(v_club.logo_url,'')),'') IS NOT NULL AND v_club.logo_url !~* '(^|/)club-logos/preset-[0-9]+[.](webp|png|jpe?g)([?#].*)?$')
    OR (NULLIF(btrim(COALESCE(v_club.avatar_url,'')),'') IS NOT NULL AND v_club.avatar_url !~* '(^|/)club-logos/preset-[0-9]+[.](webp|png|jpe?g)([?#].*)?$')
  ) THEN v_unfinished:=array_append(v_unfinished,'identity'); END IF;
  IF NOT('tagline'=ANY(v_skipped)) AND NULLIF(btrim(COALESCE(v_club.tagline,'')),'') IS NULL THEN v_unfinished:=array_append(v_unfinished,'tagline'); END IF;
  IF NOT('nlh'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tables t WHERE t.club_id=p_club_id AND lower(COALESCE(t.game_variant,'')) IN('nlh','short_deck','pineapple') AND lower(COALESCE(t.status,'')) NOT IN('deleted','archived')) THEN v_unfinished:=array_append(v_unfinished,'nlh'); END IF;
  IF NOT('plo'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tables t WHERE t.club_id=p_club_id AND lower(COALESCE(t.game_variant,'')) LIKE 'plo%' AND lower(COALESCE(t.status,'')) NOT IN('deleted','archived')) THEN v_unfinished:=array_append(v_unfinished,'plo'); END IF;
  IF NOT('limit'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tables t WHERE t.club_id=p_club_id AND (lower(COALESCE(t.game_variant,'')) IN('flh','flo8') OR lower(COALESCE(t.game_variant,'')) LIKE 'limit%') AND lower(COALESCE(t.status,'')) NOT IN('deleted','archived')) THEN v_unfinished:=array_append(v_unfinished,'limit'); END IF;
  IF NOT('mtt'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.club_id=p_club_id AND t.format_contract IN('mtt-v1','mtt-v2')) THEN v_unfinished:=array_append(v_unfinished,'mtt'); END IF;
  IF NOT('spin'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.club_id=p_club_id AND t.format_contract='spin-v1') THEN v_unfinished:=array_append(v_unfinished,'spin'); END IF;
  IF NOT('heads-up'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.club_id=p_club_id AND t.format_contract='sng-v1') THEN v_unfinished:=array_append(v_unfinished,'heads-up'); END IF;
  IF NOT('first-player'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=p_club_id AND m.user_id IS DISTINCT FROM v_club.owner_id AND m.status::text IN('active','approved')) THEN v_unfinished:=array_append(v_unfinished,'first-player'); END IF;
  IF NOT('first-agent'=ANY(v_skipped)) AND NOT EXISTS(SELECT 1 FROM public.agents a WHERE a.club_id=p_club_id AND lower(COALESCE(a.status,'active'))<>'inactive' AND lower(COALESCE(a.status,'active'))<>'wallet_only') THEN v_unfinished:=array_append(v_unfinished,'first-agent'); END IF;
  IF cardinality(v_unfinished)>0 THEN RAISE EXCEPTION 'Finish Or Skip Every Opening Checklist Step: %',array_to_string(v_unfinished,', ') USING ERRCODE='55000'; END IF;
  INSERT INTO public.club_opening_checklists AS k(club_id,completed_at,completed_by) VALUES(p_club_id,now(),v_uid)
  ON CONFLICT(club_id) DO UPDATE SET completed_at=now(),completed_by=v_uid,updated_at=now() WHERE k.completed_at IS NULL;
  SELECT * INTO v_row FROM public.club_opening_checklists k WHERE k.club_id=p_club_id;
  RETURN jsonb_build_object('clubId',p_club_id,'completedAt',v_row.completed_at,'skippedTaskIds',to_jsonb(v_row.skipped_task_ids));
END
$function$;

-- 1, 2 and the trigger: the only statements that lock public.agents, last.
ALTER TABLE public.agents
  DROP CONSTRAINT agents_status_check,
  ADD CONSTRAINT agents_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'frozen'::text, 'wallet_only'::text])),
  ADD CONSTRAINT agents_wallet_only_earns_nothing
    CHECK (status <> 'wallet_only'
           OR (commission_rate = 0 AND player_rakeback_rate = 0
               AND COALESCE(rakeback_percentage, 0) = 0
               AND parent_agent_id IS NULL
               AND credit_limit = 0 AND credit_used = 0 AND is_prepaid));

CREATE TRIGGER zz_owner_routing_wallet_guard
  BEFORE INSERT OR UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_owner_routing_wallet();

COMMIT;
