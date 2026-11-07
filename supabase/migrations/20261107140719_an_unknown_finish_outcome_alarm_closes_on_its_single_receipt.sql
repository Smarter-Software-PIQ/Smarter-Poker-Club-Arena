-- 20261107140719_an_unknown_finish_outcome_alarm_closes_on_its_single_receipt
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 14:07:19 UTC.
--
-- AN UNKNOWN FINISH OUTCOME ALARM CLOSES ON ITS SINGLE RECEIPT (2026-11-07)
--
-- When the atomic tournament finish cannot resolve the immutable receipt of a
-- completion it may already have committed, it raises
-- Tournament.atomic_finish_outcome_unknown ("Tournament completion may have
-- committed but its immutable receipt could not be resolved. Every table
-- engine was stopped.") with outcome_unknown true and proven_refusal false.
-- Nothing closed that alarm. Class 6 (20261017105512) closes a refused finish
-- and says in its own comment that a refusal whose outcome is unknown stays
-- open, which is correct for class 6 and is exactly why this source needs a
-- class of its own: 136 alerts of it since 2026-09-09, and the eight open on
-- 2026-11-07 - five raised 08:09:33-38Z, three raised 2026-11-06 07:55:29-38Z
-- - were waiting for a person to read them.
--
-- Measured 2026-11-07 14:00 UTC, all eight: COMPLETED, exactly one row in
-- tournament_terminal_settlements, escrow terminal_closed_at 8-22 s AFTER the
-- alarm with prize_balance and bounty_balance both 0.00, and payout rows
-- summing to the prize pool to the cent (20.00/20.00, 3.80/3.80, 2.00/2.00,
-- 38.00/38.00, 6.00/6.00 on 11-07; 10.00/10.00, 10.00/10.00, 40.00/40.00 on
-- 11-06). Each receipt's own prize_pool and bounty_pool equal the
-- tournament's. None of the 136 is a satellite. So the outcome is positively
-- resolved, conserved on both sides, and committed exactly once.
--
-- fn_resolve_settled_financial_alerts (cron 354 at :04/:24/:44, cron 227 at
-- :18) gains CLASS 7. The risk with an unknown outcome is the OPPOSITE of
-- class 6's: a refused finish might not have paid, an unknown finish might
-- have paid TWICE. So class 7's evidence is strictly stronger than class 6's
-- on every axis - exactly one terminal receipt (COUNTED, because a second
-- receipt is a double commit and must keep the alarm open), that receipt
-- written at or after the alarm, the receipt's prize_pool AND bounty_pool
-- equal to the tournament's, the payout rows conserving the prize pool to the
-- cent, and the escrow terminally closed at zero on both sides at or after the
-- alarm. A second receipt, a broken conservation, a tournament in any other
-- state, a malformed id, a missing or falsy outcome_unknown flag, an escrow
-- still holding chips, an escrow closed before the alarm, or a satellite all
-- stay open. The predicate is repeated verbatim under the UPDATE. CLASSES 1-6
-- ARE BYTE-FOR-BYTE UNCHANGED: this migration's postimage is the live body
-- (edc04fde4628a061caa34d9967dee310) with two declarations, one new class and
-- one new return key added, and nothing else touched.
--
-- WHY A BOUNTY TERM IS A RECEIPT TERM AND NOT A ROW SUM. The bounty side is
-- conserved by requiring the single receipt's bounty_pool to equal the
-- tournament's; the receipt table's own CHECK constraints then carry it the
-- rest of the way (cash_payout_total = prize_pool, bounty_payout_total =
-- bounty_pool), so the receipt accounts for the whole prize pool and the whole
-- bounty pool and for nothing more. A sum over bounty payout ROWS would not
-- do: a PKO's last two players keep the bounty on their own heads, those chips
-- are never a payout row, and such a term would refuse every bounty event
-- forever while proving nothing the receipt does not already prove.
--
-- GUARDS, as class 6: refuses in the break window; the live body must be the
-- exact preimage or already the postimage; owner, SECURITY DEFINER,
-- search_path and ACL are checked before and after; the readback must be the
-- exact postimage; the service-role-only grant is restated and read back.
-- This migration closes no alarm itself; the next resolver run does.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))) = 'dcbc68f86ca771e9c97f86add77b2ccd'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_FINISH_OUTCOME_ALARM_CLOSER_REFUSED: %', v_reason USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $component$
DECLARE
  v_oid oid := to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean,integer)');
  v_post constant text := $post$CREATE OR REPLACE FUNCTION public.fn_resolve_settled_financial_alerts(p_apply boolean DEFAULT false, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_paid      integer := 0;
  v_overpaid  integer := 0;
  v_settled   integer := 0;
  v_released  integer := 0;
  v_paid_ids  uuid[] := '{}';
  v_over_ids  uuid[] := '{}';
  v_settled_ids uuid[] := '{}';
  v_rel_ids   uuid[] := '{}';
  v_ops       integer := 0;
  v_ops_ids   uuid[] := '{}';
  v_fin       integer := 0;
  v_fin_ids   uuid[] := '{}';
  v_unk       integer := 0;
  v_unk_ids   uuid[] := '{}';
BEGIN
  -- ── CLASS 1: the player was accused of being unpaid and has since been paid.
  -- Proven per alert against wallet_transactions, not assumed from elapsed
  -- time. `short` is what the check said they were owed; `got` is what the
  -- prize path actually credited them for that same event.
  SELECT array_agg(id) INTO v_paid_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'fn_payout_guarantee_check'
       AND a.context->>'kind' = 'earner_not_paid'
       AND a.context->>'user_id' IS NOT NULL
       AND a.context->>'tournament_id' IS NOT NULL
       AND COALESCE((
             SELECT sum(w.amount) FROM public.wallet_transactions w
              WHERE w.related_entity_id = (a.context->>'tournament_id')::uuid
                AND w.user_id           = (a.context->>'user_id')::uuid
                AND w.type = 'credit' AND w.category = 'prize'
           ), 0) >= COALESCE((a.context->>'short')::numeric, 0) - 0.01
     LIMIT p_limit
  ) s;
  v_paid := COALESCE(array_length(v_paid_ids, 1), 0);

  -- ── CLASS 2: every issue on the alert is an overpay, which 10.6 rule 3 says
  -- is absorbed and never clawed back. There is no action left to take, so
  -- "unresolved" is a false state. An alert carrying ANY other issue kind is
  -- deliberately left open.
  SELECT array_agg(id) INTO v_over_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'fn_tournament_payout_reconcile'
       AND jsonb_typeof(a.context->'issues') = 'array'
       AND jsonb_array_length(a.context->'issues') > 0
       AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(a.context->'issues') i
              WHERE i->>'issue' IS DISTINCT FROM 'overpaid')
     LIMIT p_limit
  ) s;
  v_overpaid := COALESCE(array_length(v_over_ids, 1), 0);

  -- CLASS 3: the post-commit envelope this alert was raised about has since
  -- been applied. hand_atomic_commits.post_commit_completed_at is the durable
  -- proof; the alert is the memory of a moment when it was not yet set.
  SELECT COALESCE(array_agg(id), '{}') INTO v_settled_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.hand_atomic_commits c ON c.hand_id = (a.context->>'hand_id')::uuid
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('ServerTableEngine.post_commit_obligations_pending',
                        'LightningHandHost.post_commit_obligations_pending')
       AND (a.source <> 'LightningHandHost.post_commit_obligations_pending' OR (
         c.table_id::text = a.context->>'table_id'
         AND to_jsonb(c.hand_number) = a.context->'hand_number'
         AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
         AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
         AND c.post_commit_result->'ok' = 'true'::jsonb
         AND c.post_commit_result->>'hand_id' = c.hand_id::text
         AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)))
       AND a.context->>'hand_id' IS NOT NULL
       AND c.post_commit_completed_at IS NOT NULL
     LIMIT p_limit
  ) s;
  v_settled := COALESCE(array_length(v_settled_ids, 1), 0);

  -- CLASS 4 / STAGE 1 (PARTIAL): only an exact original accepted hand with
  -- completed required obligations can resolve here. A later hand, client
  -- claim, text-only rollback or missing identity remains actionable. A true
  -- rollback needs no same-hand commit; this stage does not certify rollbacks.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rel_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.hand_atomic_commits c ON
        c.hand_id = CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('postHandTasks.hand_history_failed',
                        'ServerTableEngine.authoritative_hand_semantic_refusal')
       AND jsonb_typeof(a.context) = 'object'
       AND a.context->>'channel' = 'server_rpc'
       AND jsonb_typeof(a.context->'hand_request_identity_v1') = 'object'
       AND a.context->'hand_request_identity_v1'->'version' = '1'::jsonb
       AND a.context->'hand_request_identity_v1'->'post_commit_required' = 'true'::jsonb
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'table_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_number') = 'number'
       AND lower(a.context->>'table_id') = lower(a.context->'hand_request_identity_v1'->>'table_id')
       AND a.context->'hand_number' = a.context->'hand_request_identity_v1'->'hand_number'
       AND c.hand_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
       AND c.table_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'table_id')::uuid END
       AND c.hand_number = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_number') ~ '^[1-9][0-9]{6,15}$'
         THEN CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint <= 9007199254740991
           THEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint END END
       AND c.payload_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
       AND jsonb_typeof(c.post_commit_payload) = 'object'
       AND c.post_commit_completed_at IS NOT NULL
       AND jsonb_typeof(c.post_commit_result) = 'object'
       AND c.post_commit_result->'ok' = 'true'::jsonb
       AND c.post_commit_result->>'hand_id' = c.hand_id::text
       AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_released := COALESCE(array_length(v_rel_ids, 1), 0);

  -- CLASS 5: a tournament operational alarm whose condition has ended. A
  -- "table can't start" alarm is over when that table has committed a hand
  -- since the alarm, or is closed; a "tournament dark after rebuild" alarm is
  -- over when any of its tables has committed a hand since the alarm. Either
  -- is over when the tournament reached COMPLETED or CANCELLED. Money is not
  -- this class's evidence: a completed event's payout has its own alarm
  -- (class 1, fn_payout_guarantee_check), which this never touches.
  SELECT COALESCE(array_agg(id), '{}') INTO v_ops_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.table_admission_failing',
                        'GameServer.tournament_dark_after_rebuild')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND (
             t.status IN ('COMPLETED', 'CANCELLED')
          OR (a.source = 'Tournament.table_admission_failing'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                     WHERE tb.id = CASE WHEN (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                        THEN (a.context->>'table_id')::uuid END
                       AND tb.tournament_id = t.id
                       AND (lower(tb.status) = 'closed'
                            OR EXISTS (SELECT 1 FROM public.hand_atomic_commits c
                                        WHERE c.table_id = tb.id
                                          AND c.committed_at > a.created_at))))
          OR (a.source = 'GameServer.tournament_dark_after_rebuild'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                      JOIN public.hand_atomic_commits c ON c.table_id = tb.id
                     WHERE tb.tournament_id = t.id
                       AND c.committed_at > a.created_at))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_ops := COALESCE(array_length(v_ops_ids, 1), 0);

  IF p_apply THEN
    -- The whole predicate again under UPDATE: a preview is not authority.
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = CASE
               WHEN t.status IN ('COMPLETED', 'CANCELLED')
                 THEN 'verified: tournament ' || t.id::text || ' reached ' || t.status
                   || COALESCE(' at ' || t.ended_at::text, '') || '; the alarm''s condition has ended.'
               WHEN a.source = 'Tournament.table_admission_failing'
                 THEN 'verified: table ' || (a.context->>'table_id')
                   || ' committed a hand or closed after this alarm; the table was admitted.'
               ELSE 'verified: tournament ' || t.id::text
                   || ' committed a hand after this alarm; it is dealing again.'
             END,
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'tournament_status_at_resolution', t.status)
        FROM public.tournaments t
       WHERE a.id = ANY(v_ops_ids)
         AND a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.table_admission_failing',
                        'GameServer.tournament_dark_after_rebuild')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND (
             t.status IN ('COMPLETED', 'CANCELLED')
          OR (a.source = 'Tournament.table_admission_failing'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                     WHERE tb.id = CASE WHEN (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                        THEN (a.context->>'table_id')::uuid END
                       AND tb.tournament_id = t.id
                       AND (lower(tb.status) = 'closed'
                            OR EXISTS (SELECT 1 FROM public.hand_atomic_commits c
                                        WHERE c.table_id = tb.id
                                          AND c.committed_at > a.created_at))))
          OR (a.source = 'GameServer.tournament_dark_after_rebuild'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                      JOIN public.hand_atomic_commits c ON c.table_id = tb.id
                     WHERE tb.tournament_id = t.id
                       AND c.committed_at > a.created_at))
           )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_ops_ids FROM changed;
    v_ops := COALESCE(array_length(v_ops_ids, 1), 0);
  END IF;

  -- CLASS 6: a proven finish refusal whose tournament has since finished. The
  -- engine retries a refused finish and, once it commits, the tournament is
  -- COMPLETED with its terminal receipt (a satellite: its settlement receipt)
  -- and its escrow closed at zero after the alarm was raised. That receipt is
  -- the end of the condition the alarm described. A refusal whose outcome is
  -- unknown, or a tournament in any other state, stays open.
  SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.atomic_finish_refused',
                        'Tournament.atomic_satellite_finish_refused')
       AND lower(COALESCE(a.context->>'proven_refusal', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
             THEN EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id AND s.settled_at IS NOT NULL)
             ELSE EXISTS (SELECT 1 FROM public.tournament_terminal_settlements s
                           WHERE s.tournament_id = t.id)
           END
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_fin := COALESCE(array_length(v_fin_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text || ' COMPLETED after this refusal; '
               || CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
                       THEN 'its satellite settlement receipt is written'
                       ELSE 'its terminal receipt is written' END
               || ' and its escrow closed at zero at ' || e.terminal_closed_at::text
               || ', so the refused finish was retried and committed.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now())
        FROM public.tournaments t, public.tournament_escrow e
       WHERE a.id = ANY(v_fin_ids)
         AND a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.atomic_finish_refused',
                        'Tournament.atomic_satellite_finish_refused')
       AND lower(COALESCE(a.context->>'proven_refusal', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
             THEN EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id AND s.settled_at IS NOT NULL)
             ELSE EXISTS (SELECT 1 FROM public.tournament_terminal_settlements s
                           WHERE s.tournament_id = t.id)
           END
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM changed;
    v_fin := COALESCE(array_length(v_fin_ids, 1), 0);
  END IF;

  -- CLASS 7: a finish whose OUTCOME WAS UNKNOWN, closed only on the single
  -- receipt that proves the finish committed exactly once. When the engine
  -- cannot resolve the immutable receipt of a completion it may already have
  -- committed, it raises Tournament.atomic_finish_outcome_unknown with
  -- outcome_unknown true and proven_refusal false and stops every table
  -- engine. Nothing closed that alarm: class 6 admits only a PROVEN refusal
  -- and says so on purpose, so 136 of these have accumulated since
  -- 2026-09-09 and the eight open on 2026-11-07 (five raised 08:09:33-38Z,
  -- three raised 2026-11-06 07:55:29-38Z) were waiting for a person.
  --
  -- The risk here is the opposite of class 6's. A refused finish might not
  -- have paid; an unknown finish might have paid TWICE. So the evidence is
  -- strictly stronger than class 6's on every axis:
  --   - EXACTLY ONE row in tournament_terminal_settlements, counted, not
  --     merely EXISTS. A second receipt is a double commit and must keep the
  --     alarm open. The table's primary key makes a second row impossible
  --     today; the count is stated anyway, because this class may not lean on
  --     a constraint it does not read.
  --   - that one receipt was written AT OR AFTER the alarm (settled_at), so
  --     the commit being closed is the one this alarm was raised about and
  --     not some earlier settlement of the same event.
  --   - the receipt's own pools equal the tournament's on BOTH sides
  --     (prize_pool and bounty_pool). With the table's own CHECK constraints
  --     (cash_payout_total = prize_pool, bounty_payout_total = bounty_pool)
  --     that is a two-sided conservation statement: the receipt accounts for
  --     the whole prize pool and the whole bounty pool and for nothing more.
  --     THAT is the bounty-pool term this class needs, and it is why there is
  --     no sum over bounty payout ROWS: a PKO's last two players keep the
  --     bounty on their own heads, and those chips are never a payout row, so
  --     a row sum would refuse every bounty event forever while proving
  --     nothing the receipt does not already prove.
  --   - the payout rows conserve the prize pool to the cent:
  --     round(sum(tournament_payouts.amount), 2) = round(prize_pool, 2). The
  --     sum is over EVERY payout row of the event, not a chosen subset, so an
  --     event that also paid bounty, satellite or correction rows does not
  --     match and its alarm STAYS OPEN for a person to read. For an outcome
  --     that might be a double commit, staying open is the safe direction,
  --     and it costs nothing today: every one of the 136 alerts of this
  --     source names a SPIN, SNG or MTT whose only payout rows are
  --     'structure' (measured 2026-11-07).
  --   - the escrow is terminally closed at zero on both sides at or after the
  --     alarm, exactly as class 6 requires.
  -- A satellite is deliberately out of scope (satellite_target_id IS NULL): a
  -- satellite's receipt is a satellite settlement whose conservation is seats
  -- and tickets rather than prize_pool, and this class makes no such
  -- statement. No alert of this source has ever named one (0 of 136, measured
  -- 2026-11-07); if one ever does, its alarm stays open.
  -- No elapsed-time term appears anywhere in this class: silence is never the
  -- evidence, only a positive receipt closes an alarm. The predicate is
  -- repeated verbatim under the UPDATE. Classes 1-6 are byte-for-byte
  -- unchanged.
  SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e,
           public.tournament_terminal_settlements r
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'Tournament.atomic_finish_outcome_unknown'
       AND lower(COALESCE(a.context->>'outcome_unknown', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND t.satellite_target_id IS NULL
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND r.tournament_id = t.id
       AND r.settled_at IS NOT NULL
       AND r.settled_at >= a.created_at
       AND (SELECT count(*) FROM public.tournament_terminal_settlements r2
             WHERE r2.tournament_id = t.id) = 1
       AND round(COALESCE(r.prize_pool, 0), 2) = round(COALESCE(t.prize_pool, 0), 2)
       AND round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)
       AND round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                            WHERE p.tournament_id = t.id), 0), 2)
             = round(COALESCE(t.prize_pool, 0), 2)
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_unk := COALESCE(array_length(v_unk_ids, 1), 0);

  IF p_apply THEN
    -- The whole predicate again under UPDATE: a preview is not authority.
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text
               || ' COMPLETED after this unknown outcome and committed exactly once: one terminal receipt, settled at '
               || r.settled_at::text || ', accounts for prize pool '
               || round(COALESCE(t.prize_pool, 0), 2)::text || ' and bounty pool '
               || round(COALESCE(t.bounty_pool, 0), 2)::text
               || '; its payout rows conserve that prize pool to the cent and its escrow closed at zero at '
               || e.terminal_closed_at::text || '.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'unknown_finish_outcome_resolution_v1', jsonb_build_object(
                 'version', 1, 'kind', 'single_terminal_receipt_conserved',
                 'tournament_id', t.id,
                 'terminal_receipt_count', (SELECT count(*) FROM public.tournament_terminal_settlements r3
                                             WHERE r3.tournament_id = t.id),
                 'receipt_settled_at', r.settled_at,
                 'prize_pool', round(COALESCE(t.prize_pool, 0), 2),
                 'bounty_pool', round(COALESCE(t.bounty_pool, 0), 2),
                 'payouts_total', round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                                                   WHERE p.tournament_id = t.id), 0), 2),
                 'escrow_terminal_closed_at', e.terminal_closed_at))
        FROM public.tournaments t, public.tournament_escrow e,
             public.tournament_terminal_settlements r
       WHERE a.id = ANY(v_unk_ids)
         AND a.resolved IS NOT TRUE
       AND a.source = 'Tournament.atomic_finish_outcome_unknown'
       AND lower(COALESCE(a.context->>'outcome_unknown', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND t.satellite_target_id IS NULL
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND r.tournament_id = t.id
       AND r.settled_at IS NOT NULL
       AND r.settled_at >= a.created_at
       AND (SELECT count(*) FROM public.tournament_terminal_settlements r2
             WHERE r2.tournament_id = t.id) = 1
       AND round(COALESCE(r.prize_pool, 0), 2) = round(COALESCE(t.prize_pool, 0), 2)
       AND round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)
       AND round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                            WHERE p.tournament_id = t.id), 0), 2)
             = round(COALESCE(t.prize_pool, 0), 2)
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM changed;
    v_unk := COALESCE(array_length(v_unk_ids, 1), 0);
  END IF;

  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved = true, resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'the post-commit envelope for this hand has been applied; post_commit_completed_at is set',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now())
     WHERE a.id = ANY(v_settled_ids);

    -- Repeat the complete guard under UPDATE: preview membership alone is not
    -- authority after a concurrent original-alert identity or status change.
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'Exact original hand ' || c.hand_id::text || ' at table ' || c.table_id::text || ' (#' || c.hand_number::text || ') was accepted; its required post-commit obligations completed at ' || c.post_commit_completed_at::text || '. This receipt does not diagnose the original failure cause.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolution', 'Exact original hand ' || c.hand_id::text || ' at table ' || c.table_id::text || ' (#' || c.hand_number::text || ') was accepted; its required post-commit obligations completed at ' || c.post_commit_completed_at::text || '. This receipt does not diagnose the original failure cause.',
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'hand_outcome_resolution_v1', jsonb_build_object(
                 'version', 1, 'kind', 'exact_original_post_commit_complete',
                 'financial_alert_id', a.id,
                 'hand_id', c.hand_id, 'table_id', c.table_id,
                 'hand_number', c.hand_number, 'post_commit_required', true,
                 'commit_hash', c.payload_hash, 'committed_at', c.committed_at,
                 'post_commit_request_hash', c.post_commit_request_hash,
                 'post_commit_payload_hash', c.post_commit_payload_hash,
                 'post_commit_completed_at', c.post_commit_completed_at,
                 'completion_ok', true))
        FROM public.hand_atomic_commits c
       WHERE a.id = ANY(v_rel_ids)
         AND a.resolved IS NOT TRUE
       AND a.source IN ('postHandTasks.hand_history_failed',
                        'ServerTableEngine.authoritative_hand_semantic_refusal')
       AND jsonb_typeof(a.context) = 'object'
       AND a.context->>'channel' = 'server_rpc'
       AND jsonb_typeof(a.context->'hand_request_identity_v1') = 'object'
       AND a.context->'hand_request_identity_v1'->'version' = '1'::jsonb
       AND a.context->'hand_request_identity_v1'->'post_commit_required' = 'true'::jsonb
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'table_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_number') = 'number'
       AND lower(a.context->>'table_id') = lower(a.context->'hand_request_identity_v1'->>'table_id')
       AND a.context->'hand_number' = a.context->'hand_request_identity_v1'->'hand_number'
       AND c.hand_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
       AND c.table_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'table_id')::uuid END
       AND c.hand_number = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_number') ~ '^[1-9][0-9]{6,15}$'
         THEN CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint <= 9007199254740991
           THEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint END END
       AND c.payload_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
       AND jsonb_typeof(c.post_commit_payload) = 'object'
       AND c.post_commit_completed_at IS NOT NULL
       AND jsonb_typeof(c.post_commit_result) = 'object'
       AND c.post_commit_result->'ok' = 'true'::jsonb
       AND c.post_commit_result->>'hand_id' = c.hand_id::text
       AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_rel_ids FROM changed;
    v_released := COALESCE(array_length(v_rel_ids, 1), 0);
  END IF;

  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved = true,
           resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'settled after the alert was raised; the prize path credited this player for this event',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now(),
             'credited', COALESCE((
               SELECT round(sum(w.amount), 2) FROM public.wallet_transactions w
                WHERE w.related_entity_id = (a.context->>'tournament_id')::uuid
                  AND w.user_id           = (a.context->>'user_id')::uuid
                  AND w.type = 'credit' AND w.category = 'prize'), 0))
     WHERE a.id = ANY(v_paid_ids);

    UPDATE public.financial_alerts a
       SET resolved = true,
           resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'overpay only; absorbed by the house per CLAUDE.md 10.6 rule 3, never clawed back',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now())
     WHERE a.id = ANY(v_over_ids);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', p_apply,
    'settled_after_alert', v_paid,
    'overpay_absorbed', v_overpaid,
    'post_commit_applied', v_settled,
    'refused_hand_released', v_released,
    'tournament_condition_ended', v_ops,
    'refused_finish_committed', v_fin,
    'unknown_finish_outcome_proven', v_unk,
    'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk,
    'still_unresolved', (SELECT count(*) FROM public.financial_alerts WHERE resolved IS NOT TRUE)
  );
END;
$function$
$post$;
  v_actual text;
BEGIN
  IF current_user <> 'postgres' OR v_oid IS NULL
     OR md5(v_post) <> 'dcbc68f86ca771e9c97f86add77b2ccd' THEN
    RAISE EXCEPTION 'unknown finish outcome closer: owner/target/embedded postimage mismatch';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
          AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
          AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
          AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname = 'fn_resolve_settled_financial_alerts') <> 1 THEN
    RAISE EXCEPTION 'unknown finish outcome closer: target authority/overload drift before';
  END IF;
  v_actual := pg_get_functiondef(v_oid);
  IF md5(v_actual) = 'dcbc68f86ca771e9c97f86add77b2ccd' THEN
    RETURN;
  END IF;
  IF md5(v_actual) <> 'edc04fde4628a061caa34d9967dee310' THEN
    RAISE EXCEPTION 'unknown finish outcome closer: unexpected live body %', md5(v_actual);
  END IF;
  EXECUTE v_post;
  IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_post THEN
    RAISE EXCEPTION 'unknown finish outcome closer: exact postimage readback failed';
  END IF;
END
$component$;

-- Already the live grant; restated so a clean rebuild never hands a browser
-- role this writer.
REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) TO service_role;

DO $acl$
BEGIN
  IF (SELECT p.proacl::text FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean,integer)'))
     IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean,integer)')
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
         AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'unknown finish outcome closer: authority drift after';
  END IF;
END
$acl$;

COMMIT;
