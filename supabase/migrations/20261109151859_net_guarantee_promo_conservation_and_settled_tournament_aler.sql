-- 20261109151859_net_guarantee_promo_conservation_and_settled_tournament_aler.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('net_guarantee_promo' in pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) > 0 AND position('net_guarantee_promo' in pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure)) > 0 AND position('net_guarantee_promo' in pg_get_functiondef('public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0 AND position('Tournament.satellite_qualifiers_refused_repeatedly' in pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure)) > 0
--
-- NET GUARANTEE PROMO CONSERVATION AND SETTLED TOURNAMENT ALERT CLOSURE
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- 1. NET GUARANTEE PROMO LEGS IN ESCROW SHADOW AND CONSERVATION BOOKS.
--    Migration 20261108041131_net_guarantee_coverage_and_union_promo_funding.sql
--    added fn_ca_fund_union_guarantee_promo_locked(uuid), which funds net
--    guarantee shortfalls at registration close by writing a chip_ledger leg
--    with category = 'promo_send', from_type = 'union_wallet',
--    to_type = 'prize_liability', metadata->>'kind' = 'net_guarantee_promo',
--    and increments tournament_escrow.gross_in and tournaments.prize_pool.
--    However, three accounting readers were not taught to read that leg:
--      - public.fn_ca_tournament_escrow_chips(uuid)
--      - public.fn_tournament_conservation_delta(uuid)
--      - public.fn_tournament_conservation_deltas(timestamptz, timestamptz)
--    As a result, completed guaranteed events funded by net_guarantee_promo
--    (38936396-91f9-4e2d-b1f9-8e4cadda4baa and 4cc11151-0dfc-4934-95f7-1731ed4c2756,
--    each with 160.00 chips of net_guarantee_promo) reported false -160.00
--    conservation deltas and false 160.00 chip settlement_error escrow balance
--    drift alerts.
--    Also, fn_tournament_conservation_delta(uuid) only recognized
--    free_buy_entry_promo legs when t.union_id = 'fade0000-0000-0000-0000-000000000001'
--    AND COALESCE(t.free_buy, false), missing Midway Free Buy events hosted on
--    club_id = 'fade0000-0000-0000-0000-000000000001' with union_id IS NULL
--    (such as 21c4c6c2-fdbe-42e3-858c-895aad31177c).
--
-- 2. RECEIPT-PROVEN SETTLEMENT CLOSURE FOR TRANSIENT TOURNAMENT / SATELLITE REFUSALS.
--    fn_resolve_settled_financial_alerts(boolean, integer) resolves transient
--    tournament alerts once the tournament reaches COMPLETED and its settlement
--    receipts and conservation check prove zero remaining obligation, but its
--    receipt_proven_tournament_alerts source list omitted
--    'Tournament.satellite_qualifiers_refused_repeatedly' and
--    'tournament.real_time_payout_refused'.
--
-- 3. STALE ALERTS ON RESOLVED INCIDENTS AND CANCELLED FREE BUY ROWS.
--    - 2 fn_ca_bounty_only_final_two_watch alerts (dfd96268, 43c88313) on
--      36fc2465 and 21c4c6c2 remained open after 36fc2465 was made good by
--      20261109010752 and 21c4c6c2 settled cleanly via ca_bounty_only_final_two.
--    - 1 TournamentRecurring.freeBuyAudit alert (fb2aa1fd) remained open
--      from a historical cancelled Free Buy row before auditFreeBuyBoard filtered
--      out CANCELLED rows, while fn_sp_midway_free_buy_watch() reports 0 issues.
--
-- No money moves in this migration; all functions are patched in place against
-- their exact live definitions with anchor count assertions.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF public.fn_ca_break_window_refuses_migrations(now()) THEN
    RAISE EXCEPTION 'Refusing to run migration inside the hourly break window (:50-:03 UTC)';
  END IF;
END
$guard$;

DO $migration$
DECLARE
  v_def text;
  v_new text;

  c_escrow_old_1 constant text :=
    '      OR (l.metadata->>''kind''=''guarantee_promo_excess_return''' || chr(10)
    || '          AND l.category=''reversal'' AND l.from_type=''prize_liability''' || chr(10)
    || '          AND l.from_entity_id=p_tournament_id))';
  c_escrow_new_1 constant text :=
    '      OR (l.metadata->>''kind''=''guarantee_promo_excess_return''' || chr(10)
    || '          AND l.category=''reversal'' AND l.from_type=''prize_liability''' || chr(10)
    || '          AND l.from_entity_id=p_tournament_id)' || chr(10)
    || '      OR (l.metadata->>''kind''=''net_guarantee_promo''' || chr(10)
    || '          AND l.category=''promo_send'' AND l.from_type=''union_wallet''' || chr(10)
    || '          AND l.to_type=''prize_liability'' AND l.to_entity_id=p_tournament_id))';

  c_delta_old_1 constant text :=
    '             OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))), 0) AS owner_out' || chr(10)
    || '    FROM public.tournaments t WHERE t.id = p_tournament_id';
  c_delta_new_1 constant text :=
    '             OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))), 0) AS owner_out,' || chr(10)
    || '      -- UNION PROMO FUNDING (2026-11-09): Midway Free Buy per-head promo,' || chr(10)
    || '      -- excess promo returns, and net guarantee promo funding.' || chr(10)
    || '      COALESCE((SELECT sum(CASE WHEN x.category = ''promo_send'' THEN x.amount ELSE -x.amount END)' || chr(10)
    || '         FROM public.chip_ledger x' || chr(10)
    || '        WHERE x.tournament_id = t.id' || chr(10)
    || '          AND ((x.metadata->>''kind'' = ''midway_free_buy_promo_head''' || chr(10)
    || '                AND x.category IN (''promo_send'', ''reversal''))' || chr(10)
    || '            OR (x.metadata->>''kind'' = ''guarantee_promo_excess_return''' || chr(10)
    || '                AND x.category = ''reversal'' AND x.from_type = ''prize_liability''' || chr(10)
    || '                AND x.from_entity_id = t.id)' || chr(10)
    || '            OR (x.metadata->>''kind'' = ''net_guarantee_promo''' || chr(10)
    || '                AND x.category = ''promo_send'' AND x.from_type = ''union_wallet''' || chr(10)
    || '                AND x.to_type = ''prize_liability'' AND x.to_entity_id = t.id))), 0) AS promo_in' || chr(10)
    || '    FROM public.tournaments t WHERE t.id = p_tournament_id';

  c_delta_old_2 constant text :=
    '    + m.ticket_in' || chr(10)
    || '    - m.owner_out';
  c_delta_new_2 constant text :=
    '    + m.ticket_in' || chr(10)
    || '    - m.owner_out' || chr(10)
    || '    + m.promo_in';

  c_deltas_old_1 constant text :=
    '      AND ((x.category = ''transfer'' AND x.idempotency_key LIKE ''owner-retirement-pool:%'')' || chr(10)
    || '        OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))' || chr(10)
    || '    GROUP BY x.tournament_id' || chr(10)
    || '  )' || chr(10)
    || '  SELECT e.id, e.name, e.variant, e.ended_at,';
  c_deltas_new_1 constant text :=
    '      AND ((x.category = ''transfer'' AND x.idempotency_key LIKE ''owner-retirement-pool:%'')' || chr(10)
    || '        OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))' || chr(10)
    || '    GROUP BY x.tournament_id' || chr(10)
    || '  ), promo_in AS MATERIALIZED (' || chr(10)
    || '    -- UNION PROMO FUNDING (2026-11-09): see the scalar.' || chr(10)
    || '    SELECT x.tournament_id AS id,' || chr(10)
    || '           sum(CASE WHEN x.category = ''promo_send'' THEN x.amount ELSE -x.amount END) AS amount' || chr(10)
    || '    FROM public.chip_ledger x JOIN eligible e ON e.id = x.tournament_id' || chr(10)
    || '    WHERE (x.metadata->>''kind'' = ''midway_free_buy_promo_head''' || chr(10)
    || '           AND x.category IN (''promo_send'', ''reversal''))' || chr(10)
    || '       OR (x.metadata->>''kind'' = ''guarantee_promo_excess_return''' || chr(10)
    || '           AND x.category = ''reversal'' AND x.from_type = ''prize_liability''' || chr(10)
    || '           AND x.from_entity_id = x.tournament_id)' || chr(10)
    || '       OR (x.metadata->>''kind'' = ''net_guarantee_promo''' || chr(10)
    || '           AND x.category = ''promo_send'' AND x.from_type = ''union_wallet''' || chr(10)
    || '           AND x.to_type = ''prize_liability'' AND x.to_entity_id = x.tournament_id)' || chr(10)
    || '    GROUP BY x.tournament_id' || chr(10)
    || '  )' || chr(10)
    || '  SELECT e.id, e.name, e.variant, e.ended_at,';

  c_deltas_old_2 constant text :=
    '      + COALESCE(ti.amount, 0) - COALESCE(oo.amount, 0), 2) END AS delta';
  c_deltas_new_2 constant text :=
    '      + COALESCE(ti.amount, 0) - COALESCE(oo.amount, 0)' || chr(10)
    || '      + COALESCE(pi.amount, 0), 2) END AS delta';

  c_deltas_old_3 constant text :=
    '  LEFT JOIN ticket_in ti ON ti.id = e.id' || chr(10)
    || '  LEFT JOIN owner_out oo ON oo.id = e.id';
  c_deltas_new_3 constant text :=
    '  LEFT JOIN ticket_in ti ON ti.id = e.id' || chr(10)
    || '  LEFT JOIN owner_out oo ON oo.id = e.id' || chr(10)
    || '  LEFT JOIN promo_in pi ON pi.id = e.id';

  c_res_old_1 constant text :=
    '      AND a.source IN (''Tournament.satellite_boundary_held'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_outcome_unknown'',' || chr(10)
    || '                       ''GameServer.tournament_repeated_recovery_refused'',' || chr(10)
    || '                       ''fn_ca_tournament_dark_while_running'')';
  c_res_new_1 constant text :=
    '      AND a.source IN (''Tournament.satellite_boundary_held'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_refused_repeatedly'',' || chr(10)
    || '                       ''Tournament.satellite_qualifiers_outcome_unknown'',' || chr(10)
    || '                       ''tournament.real_time_payout_refused'',' || chr(10)
    || '                       ''GameServer.tournament_repeated_recovery_refused'',' || chr(10)
    || '                       ''fn_ca_tournament_dark_while_running'')';

  c_res_old_2 constant text :=
    '        OR (a.source IN (''GameServer.tournament_repeated_recovery_refused'',''fn_ca_tournament_dark_while_running'')' || chr(10)
    || '          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at';
  c_res_new_2 constant text :=
    '        OR (a.source IN (''GameServer.tournament_repeated_recovery_refused'',''fn_ca_tournament_dark_while_running'',''tournament.real_time_payout_refused'')' || chr(10)
    || '          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at';
BEGIN
  -- 1. Patch fn_ca_tournament_escrow_chips(uuid)
  --    Preserves the 20261106203917 guarantee_promo_excess_return clause and adds net_guarantee_promo.
  v_def := pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure);
  IF position('guarantee_promo_excess_return' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fn_ca_tournament_escrow_chips is missing guarantee_promo_excess_return';
  END IF;
  IF position('net_guarantee_promo' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, c_escrow_old_1, ''))) / length(c_escrow_old_1) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_tournament_escrow_chips anchor 1 not found exactly once';
    END IF;
    v_new := replace(v_def, c_escrow_old_1, c_escrow_new_1);
    EXECUTE v_new;
  END IF;

  -- 2. Patch fn_tournament_conservation_delta(uuid)
  v_def := pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure);
  IF position('net_guarantee_promo' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, c_delta_old_1, ''))) / length(c_delta_old_1) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_delta anchor 1 not found exactly once';
    END IF;
    v_new := replace(v_def, c_delta_old_1, c_delta_new_1);

    IF (length(v_new) - length(replace(v_new, c_delta_old_2, ''))) / length(c_delta_old_2) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_delta anchor 2 not found exactly once';
    END IF;
    v_new := replace(v_new, c_delta_old_2, c_delta_new_2);
    EXECUTE v_new;
  END IF;

  -- 3. Patch fn_tournament_conservation_deltas(timestamptz, timestamptz)
  v_def := pg_get_functiondef('public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure);
  IF position('net_guarantee_promo' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, c_deltas_old_1, ''))) / length(c_deltas_old_1) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas anchor 1 not found exactly once';
    END IF;
    v_new := replace(v_def, c_deltas_old_1, c_deltas_new_1);

    IF (length(v_new) - length(replace(v_new, c_deltas_old_2, ''))) / length(c_deltas_old_2) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas anchor 2 not found exactly once';
    END IF;
    v_new := replace(v_new, c_deltas_old_2, c_deltas_new_2);

    IF (length(v_new) - length(replace(v_new, c_deltas_old_3, ''))) / length(c_deltas_old_3) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas anchor 3 not found exactly once';
    END IF;
    v_new := replace(v_new, c_deltas_old_3, c_deltas_new_3);
    EXECUTE v_new;
  END IF;

  -- 4. Patch fn_resolve_settled_financial_alerts(boolean, integer)
  v_def := pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure);
  IF position('Tournament.satellite_qualifiers_refused_repeatedly' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, c_res_old_1, ''))) / length(c_res_old_1) <> 1 THEN
      RAISE EXCEPTION 'fn_resolve_settled_financial_alerts anchor 1 not found exactly once';
    END IF;
    v_new := replace(v_def, c_res_old_1, c_res_new_1);

    IF (length(v_new) - length(replace(v_new, c_res_old_2, ''))) / length(c_res_old_2) <> 1 THEN
      RAISE EXCEPTION 'fn_resolve_settled_financial_alerts anchor 2 not found exactly once';
    END IF;
    v_new := replace(v_new, c_res_old_2, c_res_new_2);
    EXECUTE v_new;
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) TO service_role;

-- Verify the affected events now balance on escrow shadow, scalar delta, and set delta.
DO $assert$
DECLARE
  v_id uuid;
  v_scalar numeric;
  v_set numeric;
  v_shadow record;
  v_escrow record;
BEGIN
  FOREACH v_id IN ARRAY ARRAY[
    '38936396-91f9-4e2d-b1f9-8e4cadda4baa'::uuid,
    '4cc11151-0dfc-4934-95f7-1731ed4c2756'::uuid
  ] LOOP
    v_scalar := public.fn_tournament_conservation_delta(v_id);
    SELECT d.delta INTO v_set
      FROM public.tournaments t
      CROSS JOIN LATERAL public.fn_tournament_conservation_deltas(
        t.ended_at - interval '1 second', t.ended_at + interval '1 second') d
     WHERE t.id = v_id AND d.id = v_id;
    SELECT * INTO v_shadow FROM public.fn_ca_tournament_escrow(v_id);
    SELECT * INTO v_escrow FROM public.tournament_escrow WHERE tournament_id = v_id;

    IF v_scalar IS DISTINCT FROM 0 OR v_set IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'conservation delta for % is scalar % set %', v_id, v_scalar, v_set;
    END IF;
    IF v_shadow.prize_balance IS DISTINCT FROM v_escrow.prize_balance
       OR v_shadow.gross_in IS DISTINCT FROM v_escrow.gross_in THEN
      RAISE EXCEPTION 'escrow shadow mismatch for %: shadow (%, %) vs escrow (%, %)',
        v_id, v_shadow.gross_in, v_shadow.prize_balance, v_escrow.gross_in, v_escrow.prize_balance;
    END IF;
  END LOOP;

  -- Midway Free Buy hosted on club_id = fade0000... with union_id IS NULL also balances.
  v_scalar := public.fn_tournament_conservation_delta('21c4c6c2-fdbe-42e3-858c-895aad31177c'::uuid);
  IF v_scalar IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'conservation delta for 21c4c6c2-fdbe-42e3-858c-895aad31177c is %', v_scalar;
  END IF;
END
$assert$;

-- 1. Close the false fn_tournament_money_conservation alerts that now balance inside tolerance.
UPDATE public.financial_alerts fa
   SET resolved = true,
       resolved_at = now(),
       resolution = 'Balanced on the corrected conservation reading (20261109151859): '
         || 'fn_tournament_conservation_delta and fn_tournament_conservation_deltas now read '
         || 'net_guarantee_promo union promo funding legs (introduced by 20261108041131). '
         || 'The ledger and escrow balanced throughout; no money moved.'
 WHERE fa.source = 'fn_tournament_money_conservation'
   AND fa.resolved IS NOT TRUE
   AND fa.context->>'tournament_id' IS NOT NULL
   AND abs(public.fn_tournament_conservation_delta((fa.context->>'tournament_id')::uuid)) <= 0.05;

-- 2. Re-measure and resolve the two false ca_drift_incidents on 38936396 and 4cc11151
--    (which also resolves their twin drift_incident:fn_ca_escrow_balance_drift alerts
--    via trigger zz_ca_incident_resolution_reaches_the_alerts).
UPDATE public.ca_drift_incidents d
   SET status = 'resolved',
       resolved_at = now(),
       closure_basis = 'verified_remeasured',
       root_cause = 'fn_ca_tournament_escrow_chips(uuid) omitted net_guarantee_promo legs introduced by 20261108041131, causing the shadow gross_in and prize_balance to read -160.00 against the balanced tournament_escrow.',
       correction_ref = 'verified: migration 20261109151859_net_guarantee_promo_conservation_and_settled_tournament_aler included net_guarantee_promo in fn_ca_tournament_escrow_chips(uuid); re-measured diff = 0.00',
       resolution = 'Verified and re-measured at 0.00 escrow drift after teaching fn_ca_tournament_escrow_chips(uuid) to include net_guarantee_promo legs (20261109151859).'
  FROM public.tournament_escrow e,
       LATERAL public.fn_ca_tournament_escrow(e.tournament_id) s
 WHERE d.id IN (
         'c07848e9-4af2-456c-88fe-c68d78020e41'::uuid,
         '3ba300bc-d2be-4017-bf08-9375e0a8a5f2'::uuid
       )
   AND d.status = 'open'
   AND e.tournament_id = d.tournament_id
   AND round((COALESCE(e.prize_balance, 0) + COALESCE(e.bounty_balance, 0) + COALESCE(e.fee_balance, 0))
             - (COALESCE(s.prize_balance, 0) - COALESCE(e.reserve_out, 0) + COALESCE(e.reserve_in, 0)
                + COALESCE(s.bounty_balance, 0) + COALESCE(s.fee_balance, 0)), 2) = 0
   AND round(COALESCE(e.prize_balance, 0)
             - (COALESCE(s.prize_balance, 0) - COALESCE(e.reserve_out, 0) + COALESCE(e.reserve_in, 0)), 2) = 0;

-- 3. Resolve settled transient tournament/satellite refusal alerts whose events
--    are COMPLETED with receipt-proven settlement and zero remaining obligations.
UPDATE public.financial_alerts a
   SET resolved = true,
       resolved_at = now(),
       resolution = 'Verified the original tournament completed after the alert, with its terminal receipt and zero closed escrow.',
       context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
         'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
         'resolved_on', now(),
         'receipt_proven_tournament_completion', true
       )
  FROM public.tournaments t
  JOIN public.tournament_escrow te
    ON te.tournament_id = t.id
  LEFT JOIN public.tournament_satellite_settlements s
    ON s.tournament_id = t.id
  LEFT JOIN public.tournament_terminal_settlements f
    ON f.tournament_id = t.id
 WHERE a.resolved IS NOT TRUE
   AND a.source IN (
         'Tournament.satellite_qualifiers_refused_repeatedly',
         'tournament.real_time_payout_refused'
       )
   AND COALESCE(a.context->>'tournament_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND t.id = (a.context->>'tournament_id')::uuid
   AND t.status = 'COMPLETED'
   AND t.current_players = 0
   AND te.terminal_closed_at IS NOT NULL
   AND te.terminal_closed_at >= a.created_at
   AND COALESCE(te.prize_balance, 0) = 0
   AND COALESCE(te.bounty_balance, 0) = 0
   AND COALESCE(te.fee_balance, 0) = 0
   AND abs(public.fn_tournament_conservation_delta(t.id)) <= 0.05
   AND (
         (s.receipt_version = 3
          AND s.settled_at >= a.created_at
          AND s.source_escrow_closed_at = te.terminal_closed_at
          AND s.pool = t.prize_pool
          AND cardinality(s.qualifier_ids) > 0)
         OR (f.settled_at >= a.created_at
             AND f.completed_at >= a.created_at
             AND f.escrow_closed_at = te.terminal_closed_at
             AND f.prize_pool = t.prize_pool
             AND f.cash_payout_total = f.prize_pool
             AND f.bounty_payout_total = f.bounty_pool)
       );

-- 4. Resolve the two fn_ca_bounty_only_final_two_watch alerts whose events are
--    already settled (36fc2465 made good by 20261109010752; 21c4c6c2 settled via
--    ca_bounty_only_final_two).
UPDATE public.financial_alerts fa
   SET resolved = true,
       resolved_at = now(),
       resolution = CASE
         WHEN fa.id = 'dfd96268-a1dc-450c-88b1-ab693858b0d8'::uuid THEN
           'Resolved by 20261109151859: root cause fixed by 20261108222325 (final-two close vacates runner-up seat) and runner-up velvet9 paid 32.69 make-good by 20261109010752 (idempotency_key bounty-only-final-two-make-good:36fc2465-31e2-47d5-9a48-09206e4bdf22:d69e25e8-c1a7-4c38-8a7e-30784cba86c3).'
         WHEN fa.id = '43c88313-6c87-491a-9924-7665dc726150'::uuid THEN
           'Resolved by 20261109151859: transient refusal on 21c4c6c2-fdbe-42e3-858c-895aad31177c cleared and event completed cleanly via ca_bounty_only_final_two with both final-two residual bounties paid.'
       END
 WHERE fa.id IN (
         'dfd96268-a1dc-450c-88b1-ab693858b0d8'::uuid,
         '43c88313-6c87-491a-9924-7665dc726150'::uuid
       )
   AND fa.resolved IS NOT TRUE
   AND EXISTS (
         SELECT 1
           FROM public.chip_ledger cl
          WHERE cl.idempotency_key = 'bounty-only-final-two-make-good:36fc2465-31e2-47d5-9a48-09206e4bdf22:d69e25e8-c1a7-4c38-8a7e-30784cba86c3'
       )
   AND EXISTS (
         SELECT 1
           FROM public.ca_bounty_only_final_two f2
          WHERE f2.tournament_id = '21c4c6c2-fdbe-42e3-858c-895aad31177c'::uuid
       );

-- 5. Resolve the stale TournamentRecurring.freeBuyAudit alert raised on
--    2026-11-07 from a historical CANCELLED row, conditioned on the live Midway
--    Free Buy watch reporting zero board format/missing/settings issues.
UPDATE public.financial_alerts fa
   SET resolved = true,
       resolved_at = now(),
       resolution = 'Resolved by 20261109151859: historical duplicate count came from a CANCELLED Free Buy row; auditFreeBuyBoard now skips CANCELLED rows matching fn_sp_midway_free_buy_watch and freeBuyVerify.ts.'
 WHERE fa.id = 'fb2aa1fd-797f-4f3c-8c8f-39b19f94983f'::uuid
   AND fa.source = 'TournamentRecurring.freeBuyAudit'
   AND fa.resolved IS NOT TRUE
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(public.fn_sp_midway_free_buy_watch(now())) item
          WHERE item->>'rule' IN (
                  'midway_free_buy_missing',
                  'midway_free_buy_wrong_format',
                  'midway_free_buy_wrong_settings'
                )
       );

COMMIT;
