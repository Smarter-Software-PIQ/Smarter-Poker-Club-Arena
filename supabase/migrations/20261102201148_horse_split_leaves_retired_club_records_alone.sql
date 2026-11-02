-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- THE HORSE SPLIT LEAVES RETIRED CLUB RECORDS ALONE (2026-11-02).
--
-- The split (operation 5b11c1b0-2026-1102-0000-000000000001) stopped at 20:11Z
-- on Lightning Internal Pilot, a retired club: fn_guard_retired_club_mutation
-- makes its gameplay records read-only and club_members_bot_house_only refuses
-- any write to its horse rows. Those 144 rows hold no chips (asserted below) and
-- the club seats nobody, so the sweep and the final count leave retired clubs'
-- records alone. Nothing else changes; the operation resumes where it stopped
-- (every committed leg is receipted and keyed).
-- @live-proof: (SELECT position('20261102201148' IN pg_get_functiondef('public.fn_ca_horse_club_split_execute(uuid,integer)'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_horse_club_split_execute(uuid,integer)'::regprocedure)) IS DISTINCT FROM 'c75ae01353284c519e0925d5776c645f'
 THEN RAISE EXCEPTION 'split_execute_preimage_changed'; END IF;
 IF EXISTS (SELECT 1 FROM public.club_members cm JOIN public.clubs c ON c.id = cm.club_id AND c.lifecycle_status = 'retired'
             JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
            WHERE coalesce(cm.chip_balance,0) <> 0) THEN
  RAISE EXCEPTION 'retired_club_horse_rows_hold_chips'; END IF;
 IF EXISTS (SELECT 1 FROM public.agents a JOIN public.clubs c ON c.id = a.club_id AND c.lifecycle_status = 'retired'
             JOIN public.profiles p ON p.id = a.user_id AND p.is_horse
            WHERE coalesce(a.agent_wallet_balance,0) <> 0) THEN
  RAISE EXCEPTION 'retired_club_horse_agent_wallets_hold_chips'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_execute(p_operation uuid, p_max_rows integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  c_dss constant uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  c_felt constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_kings constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  v_op public.ca_horse_club_split_operations%ROWTYPE;
  v_pre jsonb; r record; v_done integer := 0; v_need numeric; v_have numeric; v_short numeric;
  v_mint jsonb; v_summary jsonb; v_changed integer; v_minted numeric := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_op FROM public.ca_horse_club_split_operations WHERE operation_id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'horse_club_split_unknown_operation' USING ERRCODE='22023'; END IF;
  IF v_op.stage = 'complete' THEN RETURN jsonb_build_object('stage','complete','replayed',true,'summary',v_op.summary); END IF;
  PERFORM set_config('app.horse_club_split_operation', p_operation::text, true);

  IF v_op.stage = 'draining' THEN
    v_pre := public.fn_ca_horse_club_split_preflight();
    UPDATE public.ca_horse_club_split_operations SET preflight = v_pre WHERE operation_id = p_operation;
    IF NOT (v_pre->>'ready')::boolean THEN
      RETURN jsonb_build_object('stage','draining','advanced',false,'preflight',v_pre);
    END IF;
    UPDATE public.ca_horse_club_split_state SET phase='executing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations SET stage='sweeping' WHERE operation_id = p_operation;
    v_op.stage := 'sweeping';
  END IF;

  IF v_op.stage = 'sweeping' THEN
    -- Every horse membership row: claim the player wallet into ITS club's bank;
    -- in a club the horse leaves, also claim the agent wallet and depart it.
    FOR r IN
      SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance,0) AS wallet,
             public.fn_ca_horse_assigned_club(cm.user_id) AS home,
             cm.membership_lifecycle_status AS lifecycle,
             (SELECT coalesce(a.agent_wallet_balance,0) FROM public.agents a
               WHERE a.club_id = cm.club_id AND a.user_id = cm.user_id) AS agent_wallet
        FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
       WHERE NOT EXISTS (SELECT 1 FROM public.clubs rc WHERE rc.id = cm.club_id AND rc.lifecycle_status = 'retired')
         -- A retired club's records are read-only history (fn_guard_retired_club_mutation,
         -- club_members_bot_house_only); its frozen horse rows hold no chips and are left alone (20261102201148).
         AND NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts x
                          WHERE x.operation_id = p_operation AND x.horse_id = cm.user_id AND x.club_id = cm.club_id
                            AND x.kind IN ('departed','player_wallet_claim','deferred'))
         AND (coalesce(cm.chip_balance,0) > 0
              OR (cm.membership_lifecycle_status = 'active'
                  AND cm.club_id IS DISTINCT FROM public.fn_ca_horse_assigned_club(cm.user_id)))
       ORDER BY cm.club_id, cm.user_id
       LIMIT p_max_rows
    LOOP
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'player_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      IF r.club_id IS DISTINCT FROM r.home AND r.lifecycle = 'active' AND EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                         LEFT JOIN public.clubs h ON h.id = t.club_id
                        WHERE tp.user_id = r.horse_id AND tp.club_id = r.club_id
                          AND lower(coalesce(tp.status::text,'')) IN ('registered','playing')
                          AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED')
                          AND NOT coalesce(h.is_platform, false)) THEN
        -- An open entry is still paid from this membership: it departs when its
        -- events finish (stage settling, 20261102191900).
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'deferred', jsonb_build_object('assigned_club', r.home))
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
      ELSIF r.club_id IS DISTINCT FROM r.home AND r.lifecycle = 'active' THEN
        IF coalesce(r.agent_wallet,0) > 0 THEN
          PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'agent_wallet_claim', r.club_id, r.horse_id, r.agent_wallet);
        END IF;
        -- Horses below a departing horse agent go direct to the club.
        WITH released AS (
          UPDATE public.club_members d
             SET agent_id = CASE WHEN d.agent_id = r.horse_id THEN NULL ELSE d.agent_id END,
                 parent_agent_id = CASE WHEN d.parent_agent_id = r.horse_id THEN NULL ELSE d.parent_agent_id END,
                 updated_at = clock_timestamp()
           WHERE d.club_id = r.club_id AND d.user_id <> r.horse_id
             AND d.membership_lifecycle_status = 'active'
             AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)
             AND EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = d.user_id AND hp.is_horse)
          RETURNING d.user_id)
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        SELECT p_operation, x.user_id, r.club_id, 'downline_released', jsonb_build_object('former_agent', r.horse_id)
          FROM released x
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
        IF EXISTS (SELECT 1 FROM public.club_members d JOIN public.profiles hp ON hp.id = d.user_id AND NOT coalesce(hp.is_horse,false)
                    WHERE d.club_id = r.club_id AND d.membership_lifecycle_status = 'active' AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)) THEN
          RAISE EXCEPTION 'horse_split_human_downline % %', r.club_id, r.horse_id;
        END IF;
        UPDATE public.agents SET status = 'suspended', updated_at = clock_timestamp()
         WHERE club_id = r.club_id AND user_id = r.horse_id AND status IS DISTINCT FROM 'suspended';
        PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
        UPDATE public.club_members cm
           SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
               departed_at = clock_timestamp(), departed_by = NULL,
               departure_reason = 'Horse Club Split (Dan, 2026-11-02)', updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id AND cm.membership_lifecycle_status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
        IF v_changed <> 1 THEN RAISE EXCEPTION 'horse_split_membership_changed % %', r.club_id, r.horse_id; END IF;
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'departed', jsonb_build_object('assigned_club', r.home));
      END IF;
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','sweeping','advanced',true,'rows',v_done,'more',true);
    END IF;
    -- A manifest horse without an active membership in its assigned club joins
    -- it now (22 on 2026-11-02: 18 Felt-only horses moved to Deep Stack and 4
    -- held no Deep Stack or Felt membership). Same source the join door uses;
    -- a horse membership starts at zero and is funded below.
    FOR r IN SELECT a.horse_id, a.club_id,
                    (SELECT cm.membership_lifecycle_status FROM public.club_members cm
                      WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id) AS lifecycle
               FROM public.ca_horse_club_assignments a
              WHERE NOT EXISTS (SELECT 1 FROM public.club_members cm
                                 WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id
                                   AND cm.membership_lifecycle_status = 'active'
                                   AND coalesce(cm.status,'active') IN ('active','approved')) LOOP
      IF r.lifecycle IS NULL THEN
        PERFORM set_config('app.club_membership_source', 'join_club', true);
        INSERT INTO public.club_members(club_id, user_id, role, status, is_active, is_bot, chip_balance, membership_lifecycle_status)
        VALUES (r.club_id, r.horse_id, 'player', 'active', true, true, 0, 'active');
        PERFORM set_config('app.club_membership_source', '', true);
      ELSE
        PERFORM set_config('app.club_membership_lifecycle_write', 'rejoin', true);
        UPDATE public.club_members cm
           SET status = 'active', is_active = true, membership_lifecycle_status = 'active',
               departed_at = NULL, departed_by = NULL, departure_reason = NULL, updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
      VALUES (p_operation, r.horse_id, r.club_id, 'joined', jsonb_build_object('previous_lifecycle', r.lifecycle))
      ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='minting' WHERE operation_id = p_operation;
    v_op.stage := 'minting';
  END IF;

  IF v_op.stage = 'minting' THEN
    FOR r IN SELECT x.club_id, count(*) AS horses FROM public.ca_horse_club_assignments x GROUP BY x.club_id LOOP
      IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts m
                  WHERE m.operation_id = p_operation AND m.club_id = r.club_id AND m.kind = 'mint') THEN CONTINUE; END IF;
      v_need := r.horses * 10000 - coalesce((SELECT sum(f.amount) FROM public.ca_horse_club_split_receipts f
                  WHERE f.operation_id = p_operation AND f.club_id = r.club_id AND f.kind = 'fund_10000'), 0);
      SELECT coalesce(c.chip_treasury,0) INTO v_have FROM public.clubs c WHERE c.id = r.club_id FOR UPDATE;
      v_short := greatest(0, v_need - v_have);
      IF v_short > 0 THEN
        IF v_minted + v_short > v_op.mint_cap THEN
          RAISE EXCEPTION 'horse_split_mint_exceeds_authorized_cap club % short % cap %', r.club_id, v_short, v_op.mint_cap;
        END IF;
        -- The Mint takes only the service identity; this body is reachable only
        -- by a trusted caller (fn_caller_is_engine above).
        PERFORM set_config('request.jwt.claim.role', 'service_role', true);
        v_mint := public.fn_ca_mint('chips', 'club', r.club_id, round(v_short, 2),
          'Horse Club Split: Shortfall To Restart Every Assigned Horse At 10,000 (Dan, 2026-11-02)',
          'horse-club-split:' || p_operation::text || ':mint:' || r.club_id::text, 'admin');
        IF coalesce((v_mint->>'ok')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'horse_split_mint_refused %', v_mint;
        END IF;
        v_minted := v_minted + v_short;
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, amount, bank_before, bank_after, detail)
      VALUES (p_operation, NULL, r.club_id, 'mint', v_short, v_have, v_have + v_short,
              jsonb_build_object('needed', v_need, 'mint', coalesce(v_mint, '{}'::jsonb)));
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='funding' WHERE operation_id = p_operation;
    v_op.stage := 'funding';
  END IF;

  IF v_op.stage = 'funding' THEN
    v_done := 0;
    FOR r IN SELECT a.horse_id, a.club_id, coalesce(cm.chip_balance,0) AS wallet
               FROM public.ca_horse_club_assignments a
               JOIN public.club_members cm ON cm.user_id = a.horse_id AND cm.club_id = a.club_id
              WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts f
                                 WHERE f.operation_id = p_operation AND f.horse_id = a.horse_id
                                   AND f.club_id = a.club_id AND f.kind = 'fund_10000')
              ORDER BY a.club_id, a.horse_id LIMIT p_max_rows LOOP
      -- Chips that reached the assigned wallet after its sweep (a running event
      -- paying out) go to the bank first, so every horse restarts at exactly
      -- 10,000 (20261102191900).
      IF r.wallet < 0 THEN RAISE EXCEPTION 'horse_split_negative_wallet % %', r.horse_id, r.wallet; END IF;
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'settle_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'fund_10000', r.club_id, r.horse_id, 10000);
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','funding','advanced',true,'rows',v_done,'more',true);
    END IF;
    UPDATE public.ca_horse_club_split_operations SET stage='enforcing' WHERE operation_id = p_operation;
    v_op.stage := 'enforcing';
  END IF;

  IF v_op.stage = 'enforcing' THEN
    -- Every assigned horse was funded from zero to exactly 10,000 (20261102191900).
    IF EXISTS (SELECT 1 FROM public.ca_horse_club_assignments a
                WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts f
                                   WHERE f.operation_id = p_operation AND f.horse_id = a.horse_id AND f.club_id = a.club_id
                                     AND f.kind = 'fund_10000' AND f.wallet_before = 0 AND f.wallet_after = 10000)) THEN
      RAISE EXCEPTION 'horse_split_assigned_horse_not_funded_to_10000';
    END IF;
    SELECT jsonb_build_object(
      'deep_stack', count(*) FILTER (WHERE cm.club_id = c_dss AND a.club_id = c_dss),
      'felt', count(*) FILTER (WHERE cm.club_id = c_felt AND a.club_id = c_felt))
      INTO v_summary
      FROM public.club_members cm JOIN public.ca_horse_club_assignments a ON a.horse_id = cm.user_id
     WHERE cm.membership_lifecycle_status = 'active';
    IF (v_summary->>'deep_stack')::int <> 500 OR (v_summary->>'felt')::int <> 500 THEN
      RAISE EXCEPTION 'horse_split_assignment_state_wrong %', v_summary;
    END IF;
    UPDATE public.ca_horse_club_split_state SET phase='enforcing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations SET stage='settling' WHERE operation_id = p_operation;
    v_op.stage := 'settling';
  END IF;

  IF v_op.stage = 'settling' THEN
    -- Memberships deferred for an open entry depart once their events finish (20261102191900).
    v_done := 0;
    FOR r IN
      SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance,0) AS wallet,
             public.fn_ca_horse_assigned_club(cm.user_id) AS home,
             (SELECT coalesce(ag.agent_wallet_balance,0) FROM public.agents ag
               WHERE ag.club_id = cm.club_id AND ag.user_id = cm.user_id) AS agent_wallet
        FROM public.ca_horse_club_split_receipts d
        JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
       WHERE d.operation_id = p_operation AND d.kind = 'deferred'
         AND cm.membership_lifecycle_status = 'active'
       ORDER BY cm.club_id, cm.user_id
       LIMIT p_max_rows
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                         LEFT JOIN public.clubs h ON h.id = t.club_id
                        WHERE tp.user_id = r.horse_id AND tp.club_id = r.club_id
                          AND lower(coalesce(tp.status::text,'')) IN ('registered','playing')
                          AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED')
                          AND NOT coalesce(h.is_platform, false));
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'settle_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      IF coalesce(r.agent_wallet,0) > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'agent_wallet_claim', r.club_id, r.horse_id, r.agent_wallet);
      END IF;
        -- Horses below a departing horse agent go direct to the club.
        WITH released AS (
          UPDATE public.club_members d
             SET agent_id = CASE WHEN d.agent_id = r.horse_id THEN NULL ELSE d.agent_id END,
                 parent_agent_id = CASE WHEN d.parent_agent_id = r.horse_id THEN NULL ELSE d.parent_agent_id END,
                 updated_at = clock_timestamp()
           WHERE d.club_id = r.club_id AND d.user_id <> r.horse_id
             AND d.membership_lifecycle_status = 'active'
             AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)
             AND EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = d.user_id AND hp.is_horse)
          RETURNING d.user_id)
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        SELECT p_operation, x.user_id, r.club_id, 'downline_released', jsonb_build_object('former_agent', r.horse_id)
          FROM released x
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
        IF EXISTS (SELECT 1 FROM public.club_members d JOIN public.profiles hp ON hp.id = d.user_id AND NOT coalesce(hp.is_horse,false)
                    WHERE d.club_id = r.club_id AND d.membership_lifecycle_status = 'active' AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)) THEN
          RAISE EXCEPTION 'horse_split_human_downline % %', r.club_id, r.horse_id;
        END IF;
        UPDATE public.agents SET status = 'suspended', updated_at = clock_timestamp()
         WHERE club_id = r.club_id AND user_id = r.horse_id AND status IS DISTINCT FROM 'suspended';
        PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
        UPDATE public.club_members cm
           SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
               departed_at = clock_timestamp(), departed_by = NULL,
               departure_reason = 'Horse Club Split (Dan, 2026-11-02)', updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id AND cm.membership_lifecycle_status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
        IF v_changed <> 1 THEN RAISE EXCEPTION 'horse_split_membership_changed % %', r.club_id, r.horse_id; END IF;
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'departed', jsonb_build_object('assigned_club', r.home));
      v_done := v_done + 1;
    END LOOP;
    SELECT count(*) INTO v_changed
      FROM public.ca_horse_club_split_receipts d
      JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
     WHERE d.operation_id = p_operation AND d.kind = 'deferred' AND cm.membership_lifecycle_status = 'active';
    IF v_changed > 0 THEN
      RETURN jsonb_build_object('stage','settling','departed_now',v_done,'still_deferred',v_changed);
    END IF;
    SELECT jsonb_build_object(
      'deep_stack', count(*) FILTER (WHERE cm.club_id = c_dss),
      'felt', count(*) FILTER (WHERE cm.club_id = c_felt),
      'kings', count(*) FILTER (WHERE cm.club_id = c_kings),
      'other_active_horse_memberships', count(*) FILTER (WHERE cm.club_id NOT IN (c_dss, c_felt)))
      INTO v_summary
      FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
      LEFT JOIN public.clubs h ON h.id = cm.club_id
     WHERE cm.membership_lifecycle_status = 'active' AND NOT coalesce(h.is_platform, false)
       AND h.lifecycle_status IS DISTINCT FROM 'retired';
    IF (v_summary->>'deep_stack')::int <> 500 OR (v_summary->>'felt')::int <> 500
       OR (v_summary->>'kings')::int <> 0 OR (v_summary->>'other_active_horse_memberships')::int <> 0 THEN
      RAISE EXCEPTION 'horse_split_final_state_wrong %', v_summary;
    END IF;
    v_summary := v_summary || jsonb_build_object(
      'minted', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='mint'),
      'claimed_player', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind IN ('player_wallet_claim','settle_wallet_claim')),
      'claimed_agent', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='agent_wallet_claim'),
      'funded', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='fund_10000'),
      'departed', (SELECT count(*) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='departed'),
      'manifest_sha256', '22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270');
    UPDATE public.ca_horse_club_split_operations
       SET stage='complete', completed_at=clock_timestamp(), summary=v_summary WHERE operation_id = p_operation;
    RETURN jsonb_build_object('stage','complete','summary',v_summary);
  END IF;
  RETURN jsonb_build_object('stage', v_op.stage);
END $$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_execute(uuid, integer) FROM PUBLIC, anon, authenticated;
COMMIT;
