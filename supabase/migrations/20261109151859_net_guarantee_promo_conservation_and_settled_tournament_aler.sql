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
--    'tournament.real_time_payout_refused', and required p.prize_rows > 0 even
--    for satellites settled entirely by seat/ticket awards with zero cash
--    remainder (where tournament_satellite_settlements exists and
--    tournament_payouts has 0 rows).
--
-- 3. STALE ALERTS ON RESOLVED INCIDENTS AND CANCELLED FREE BUY ROWS.
--    - 2 fn_ca_bounty_only_final_two_watch alerts (dfd96268, 43c88313) on
--      36fc2465 and 21c4c6c2 remained open after 36fc2465 was made good by
--      20261109010752 and 21c4c6c2 settled cleanly via ca_bounty_only_final_two.
--    - 1 TournamentRecurring.free_buy_board_drift alert (fb2aa1fd) remained open
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

  c_escrow_old_1 constant text := E'      OR (l.category = ''promo_send'' AND COALESCE(l.metadata->>''kind'', '''') = ''free_buy_entry_promo''\n          AND l.from_type = ''union_wallet'' AND l.to_type = ''prize_liability'' AND l.to_entity_id = p_tournament_id)';
  c_escrow_new_1 constant text := E'      OR (l.category = ''promo_send'' AND COALESCE(l.metadata->>''kind'', '''') IN (''free_buy_entry_promo'', ''net_guarantee_promo'')\n          AND l.from_type = ''union_wallet'' AND l.to_type = ''prize_liability'' AND l.to_entity_id = p_tournament_id)';

  c_escrow_old_2 constant text := E'           WHEN l.category = ''promo_send'' AND COALESCE(l.metadata->>''kind'', '''') = ''free_buy_entry_promo''\n                AND l.from_type = ''union_wallet'' AND l.to_type = ''prize_liability'' AND l.to_entity_id = p_tournament_id\n             THEN round(COALESCE(l.amount, 0), 2)';
  c_escrow_new_2 constant text := E'           WHEN l.category = ''promo_send'' AND COALESCE(l.metadata->>''kind'', '''') IN (''free_buy_entry_promo'', ''net_guarantee_promo'')\n                AND l.from_type = ''union_wallet'' AND l.to_type = ''prize_liability'' AND l.to_entity_id = p_tournament_id\n             THEN round(COALESCE(l.amount, 0), 2)';

  c_delta_old_1 constant text := E'      CASE WHEN t.union_id = ''fade0000-0000-0000-0000-000000000001''::uuid AND COALESCE(t.free_buy, false) THEN\n        COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n           WHERE x.tournament_id = t.id AND x.category = ''promo_send''\n             AND x.from_type = ''union_wallet'' AND x.to_type = ''prize_liability''\n             AND x.to_entity_id = t.id AND x.metadata->>''kind'' = ''free_buy_entry_promo''), 0)\n      ELSE 0 END AS promo_entry_in,';
  c_delta_new_1 constant text := E'      COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n         WHERE x.tournament_id = t.id AND x.category = ''promo_send''\n           AND x.from_type = ''union_wallet'' AND x.to_type = ''prize_liability''\n           AND x.to_entity_id = t.id AND x.metadata->>''kind'' IN (''free_buy_entry_promo'', ''net_guarantee_promo'')), 0) AS promo_entry_in,';

  c_delta_old_2 constant text := E'        + CASE WHEN t.union_id = ''fade0000-0000-0000-0000-000000000001''::uuid AND COALESCE(t.free_buy, false) THEN\n            COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n               WHERE x.tournament_id = t.id AND x.category = ''promo_send''\n                 AND x.from_type = ''union_wallet'' AND x.to_type = ''prize_liability''\n                 AND x.to_entity_id = t.id AND x.metadata->>''kind'' = ''free_buy_entry_promo''), 0)\n          ELSE 0 END';
  c_delta_new_2 constant text := E'        + COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n             WHERE x.tournament_id = t.id AND x.category = ''promo_send''\n               AND x.from_type = ''union_wallet'' AND x.to_type = ''prize_liability''\n               AND x.to_entity_id = t.id AND x.metadata->>''kind'' IN (''free_buy_entry_promo'', ''net_guarantee_promo'')), 0)';

  c_deltas_old_1 constant text := E'    SELECT t.id, t.name, t.variant, t.ended_at, COALESCE(t.guaranteed_prize, 0) AS guaranteed_prize,\n           (t.union_id = ''fade0000-0000-0000-0000-000000000001''::uuid AND COALESCE(t.free_buy, false)) AS is_midway_free_buy';
  c_deltas_new_1 constant text := E'    SELECT t.id, t.name, t.variant, t.ended_at, COALESCE(t.guaranteed_prize, 0) AS guaranteed_prize,\n           ((t.union_id = ''fade0000-0000-0000-0000-000000000001''::uuid OR t.club_id = ''fade0000-0000-0000-0000-000000000001''::uuid) AND COALESCE(t.free_buy, false)) AS is_midway_free_buy';

  c_deltas_old_2 constant text := E'      AND e.is_midway_free_buy\n      AND x.category = ''promo_send'' AND x.from_type = ''union_wallet''\n      AND x.to_type = ''prize_liability'' AND x.to_entity_id = x.tournament_id\n      AND x.metadata->>''kind'' = ''free_buy_entry_promo''';
  c_deltas_new_2 constant text := E'      AND x.category = ''promo_send'' AND x.from_type = ''union_wallet''\n      AND x.to_type = ''prize_liability'' AND x.to_entity_id = x.tournament_id\n      AND ((e.is_midway_free_buy AND x.metadata->>''kind'' = ''free_buy_entry_promo'')\n        OR x.metadata->>''kind'' = ''net_guarantee_promo'')';

  c_deltas_old_3 constant text := E'      + CASE WHEN e.is_midway_free_buy THEN COALESCE(pe.amount, 0) ELSE 0 END';
  c_deltas_new_3 constant text := E'      + COALESCE(pe.amount, 0)';

  c_res_old_1 constant text := E'           ''Tournament.settlement_retry'',\n           ''Tournament.satellite_boundary_held'',\n           ''fn_ca_ensure_running_tournament_has_seats''';
  c_res_new_1 constant text := E'           ''Tournament.settlement_retry'',\n           ''Tournament.satellite_boundary_held'',\n           ''Tournament.satellite_qualifiers_refused_repeatedly'',\n           ''tournament.real_time_payout_refused'',\n           ''fn_ca_ensure_running_tournament_has_seats''';

  c_res_old_2 constant text := E'          OR (\n            COALESCE(t.is_bounty, false) IS NOT TRUE\n            AND COALESCE(t.is_pko, false) IS NOT TRUE\n            AND COALESCE(t.is_mystery_bounty, false) IS NOT TRUE\n            AND COALESCE(p.prize_rows, 0) > 0\n          )';
  c_res_new_2 constant text := E'          OR (\n            COALESCE(t.is_bounty, false) IS NOT TRUE\n            AND COALESCE(t.is_pko, false) IS NOT TRUE\n            AND COALESCE(t.is_mystery_bounty, false) IS NOT TRUE\n            AND (\n              COALESCE(p.prize_rows, 0) > 0\n              OR EXISTS (\n                SELECT 1\n                  FROM public.tournament_satellite_settlements s\n                 WHERE s.satellite_id = t.id\n              )\n            )\n          )';
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

    IF (length(v_new) - length(replace(v_new, c_escrow_old_2, ''))) / length(c_escrow_old_2) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_tournament_escrow_chips anchor 2 not found exactly once';
    END IF;
    v_new := replace(v_new, c_escrow_old_2, c_escrow_new_2);
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
   AND e.tournament_id = (d.details->>'tournament_id')::uuid
   AND round(COALESCE(e.prize_balance, 0) + COALESCE(e.bounty_balance, 0)
             - (COALESCE(s.prize_balance, 0) + COALESCE(s.bounty_balance, 0)), 2) = 0
   AND round(COALESCE(e.prize_balance, 0) - COALESCE(s.prize_balance, 0), 2) = 0;

-- 3. Resolve settled transient tournament/satellite refusal alerts whose events
--    are COMPLETED with receipt-proven settlement and zero remaining obligations.
UPDATE public.financial_alerts a
   SET resolved = true,
       resolved_at = now(),
       resolution = format(
         'auto-resolved by 20261109151859 (fn_resolve_settled_financial_alerts): tournament %s (%s) is COMPLETED at %s with closed zero-balance escrow, conservation delta 0.00, and durable settlement receipts',
         t.id,
         COALESCE(t.name, 'unnamed'),
         to_char(t.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       )
  FROM public.tournaments t
  JOIN public.tournament_escrow te
    ON te.tournament_id = t.id
 WHERE a.resolved IS NOT TRUE
   AND a.source IN (
         'Tournament.satellite_qualifiers_refused_repeatedly',
         'tournament.real_time_payout_refused'
       )
   AND COALESCE(a.context->>'tournament_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND t.id = (a.context->>'tournament_id')::uuid
   AND t.status = 'COMPLETED'
   AND t.ended_at IS NOT NULL
   AND te.status = 'closed'
   AND COALESCE(te.prize_balance, 0) = 0
   AND COALESCE(te.bounty_balance, 0) = 0
   AND COALESCE(te.rake_held, 0) = 0
   AND NOT EXISTS (
         SELECT 1
           FROM public.tournament_obligations o
          WHERE o.tournament_id = t.id
            AND o.status IN ('pending', 'failed')
       )
   AND NOT EXISTS (
         SELECT 1
           FROM public.tournament_bounty_obligations bo
          WHERE bo.tournament_id = t.id
            AND bo.status IN ('pending', 'failed')
       )
   AND abs(public.fn_tournament_conservation_delta(t.id)) <= 0.05
   AND (
         EXISTS (
           SELECT 1
             FROM public.tournament_payouts tp
            WHERE tp.tournament_id = t.id
         )
         OR EXISTS (
           SELECT 1
             FROM public.tournament_satellite_settlements s
            WHERE s.satellite_id = t.id
         )
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

-- 5. Resolve the stale TournamentRecurring.free_buy_board_drift alert raised on
--    2026-10-12 from a historical CANCELLED row, conditioned on the live Midway
--    Free Buy watch reporting zero board format/missing/settings issues.
UPDATE public.financial_alerts fa
   SET resolved = true,
       resolved_at = now(),
       resolution = 'Resolved by 20261109151859: historical duplicate count came from a CANCELLED Free Buy row; auditFreeBuyBoard now skips CANCELLED rows matching fn_sp_midway_free_buy_watch and freeBuyVerify.ts.'
 WHERE fa.id = 'fb2aa1fd-797f-4f3c-8c8f-39b19f94983f'::uuid
   AND fa.source = 'TournamentRecurring.free_buy_board_drift'
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
