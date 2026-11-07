-- 20261107165633_a_false_escrow_drift_alert_closes_on_a_re_measurement
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 16:56:33 UTC.
--
-- A FALSE ESCROW DRIFT ALERT CLOSES ON A RE-MEASUREMENT (2026-11-07)
--
-- 26 financial_alerts rows of source 'drift_incident:fn_ca_escrow_balance_drift'
-- are open and nothing on this platform can ever retire them.
--
--   - The detector fix landed earlier today (20261107143600, live body md5
--     9898d7b3dc17564f522892164c85de65, carrying both a v_diff <> 0 guard and
--     an owner-correction door). It stops the NEXT false alert. It closes none
--     of these.
--   - All 26 escrow rows carry terminal_closed_at, so
--     fn_terminal_tournament_escrow_is_immutable refuses every write to them.
--   - 35,479 escrow rows are newer than the oldest of the 26, so the sweep's
--     own ORDER BY updated_at DESC LIMIT 5000 window can never reach them
--     again, however many times it runs.
--
-- A closer is the only thing that can retire them, and it has to earn each
-- one. fn_resolve_settled_financial_alerts gains CLASS 8.
--
-- WHAT THE 26 ARE, RE-MEASURED AGAINST PRODUCTION 2026-11-07 16:45 UTC.
--
--   25 of them, every one filed by the same sweep tick at
--   2026-11-03 12:35:00.159115+00, across 25 distinct tournaments, all
--   CANCELLED Spins, each with discrepancy_amount exactly 0.00. The detector
--   trips per bank and files the SUM of the three bank gaps as the
--   discrepancy. On a fully refunded cancelled Spin the chip shadow keeps the
--   booked entry rake in its fee bank - its own rake filter drops the negative
--   atomic_cancel_tournament reversal on purpose - while
--   tournament_refund_tranches returns the whole gross out of the prize bank.
--   So two banks disagree by the same amount with opposite signs and the total
--   is 0.00. Re-measured now, all 25 read escrow prize 0.00 / bounty 0.00 /
--   fee 0.00 against a shadow of prize -g / bounty 0.00 / fee +g, with g one
--   of 0.24, 0.48, 0.72, 1.20, 2.40, 4.80, 12.00 or 24.00 chips - each exactly
--   8% of that event's gross - and a measured discrepancy of 0.00 on every
--   one. No chips are missing on any of them and nobody is owed anything. A
--   settlement error of zero chips is not a settlement error.
--
--   1 of them, detected_at 2026-11-02 06:35:00.134568+00, discrepancy -950.00,
--   tournament 6b72abc3-bd16-488c-aea5-54b1eace98d5: the owner-authorized
--   bounty/guarantee correction. Re-measured now: escrow prize 0.00 / bounty
--   0.00 / fee 0.00, shadow prize 950.00, so the whole -950.00 gap sits in the
--   prize bank, and chip_ledger carries the leg that accounts for it -
--   idempotency_key
--   'tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102',
--   category 'reversal', amount 950.00, prize_liability (this tournament) ->
--   union_bank, metadata kind 'owner_bounty_guarantee_correction', with both
--   journalled row images and the owner instruction. A movement that is
--   journalled is accounted for, not drift.
--
-- SILENCE IS NEVER THE EVIDENCE. All 26 twin ca_drift_incidents rows are
-- ALREADY status 'resolved' with closure_basis 'aged_out_unverified' - retired
-- because the source went quiet, which establishes nothing (law 10.86 rule 1,
-- and the reason fn_ca_incident_resolution_reaches_the_alerts refuses to
-- propagate an age-out to an alert at all). Across the whole drift_incident:*
-- family on 2026-11-07: 46 unresolved alerts, 42 closed twins, of which only 3
-- are verified_remeasured and 39 are aged_out_unverified. A closer that
-- propagated incident closure would therefore shut 39 alerts - these 26
-- included - on no evidence whatsoever, and would look exactly like a closer
-- that had proven something. So class 8 reads NEITHER the twin's resolved, NOR
-- resolved_at, NOR closure_basis, and no elapsed time: it names no time
-- window and does no clock arithmetic of any kind. It re-measures, per alert,
-- and closes only what the measurement refutes.
--
-- THE PREDICATE is the live detector's own quantity, written the way the
-- detector writes it, so the two cannot mean different things by "a finding":
--
--   v_diff      = round((r.prize_balance + r.bounty_balance + r.fee_balance)
--                 - (e.prize_balance - r.reserve_out + r.reserve_in
--                    + e.bounty_balance + e.fee_balance), 2)
--   v_prize_gap = round(r.prize_balance
--                 - (e.prize_balance - r.reserve_out + r.reserve_in), 2)
--
-- with r the live tournament_escrow row and e its chip shadow, and an alert
-- closes when
--
--   r.terminal_closed_at IS NOT NULL
--   AND (v_diff = 0                                              -- class A
--        OR (v_diff <> 0 AND v_prize_gap = v_diff                -- class B
--            AND EXISTS one chip_ledger row of this tournament with the
--            tournament-scoped owner_bounty_guarantee idempotency key,
--            category 'reversal', from_type 'prize_liability' with this
--            tournament as from_entity_id, to_type 'union_bank' with a
--            destination, metadata kind 'owner_bounty_guarantee_correction',
--            a 'tournament_before' object, a 'tournament_after' object, an
--            'owner_instruction' string, and round(l.amount, 2) = - v_diff))
--
-- No tournament id is hard-coded. A gap whose ledger row is absent, of another
-- kind, of another direction, of another amount, or landing outside the prize
-- bank is STILL A FINDING and its alert stays open. Where a re-measure says a
-- finding is still live, the alert is left alone - and on 2026-11-07 no such
-- case exists among the 26: 25 measure 0.00 and the 26th is the journalled
-- correction, exactly.
--
-- WHY terminal_closed_at IS REQUIRED, and why that makes the measurement final
-- rather than momentary. Proven in a rolled-back production transaction today:
-- once an escrow is terminally closed, BOTH sides of the measurement are
-- immutable. The escrow row itself is refused by
-- fn_terminal_tournament_escrow_is_immutable, and the tables the shadow reads
-- refuse too - an insert into tournament_rake_settlements or
-- tournament_refund_tranches for such an event fails with "terminal
-- tournament <id> has immutable ... evidence". A live escrow could read 0.00
-- this second and drift the next; a terminally closed one cannot move again,
-- so a zero measured there is a permanent fact about that event.
--
-- WHY THE PREDICATE IS NOT SHARED WITH THE DETECTOR AS ONE HELPER. A
-- fn_ca_escrow_drift_is_still_a_finding(uuid) called by both was considered
-- and rejected, for two reasons that both say the same thing - the cure is
-- worse than the disease.
--   1. The detector's loop RE-READS its escrow row immediately before it calls
--      the shadow, so the two reads are milliseconds apart; that is its
--      explicit same-instant guarantee from 2026-09-05, written after a payout
--      landing mid-loop moved the shadow and not the row in hand. A boolean
--      helper would do its own two reads, and the loop would still need its
--      own r and e for the incident payload: two measurements at two instants
--      where there is now one. Sharing the predicate would un-fix a fixed bug.
--   2. The helper would have to call the shadow chips function by name, and
--      so would this migration. tests/attention-items-close-at-their-roots.law.test.ts
--      binds the guarantee_promo_excess_return clause to the NEWEST migration
--      that names that function anywhere, comments included. Naming it here
--      would move that law onto a file which does not define the shadow and
--      cannot carry the clause, masking a real future regression of it. This
--      migration therefore calls fn_ca_tournament_escrow - the dispatcher the
--      detector itself calls - and never names the chips function it dispatches
--      to.
-- Instead the two are pinned to each other TEXTUALLY:
-- tests/an-escrow-drift-alert-closes-on-a-re-measurement.law.test.ts asserts
-- that class 8's v_diff term, its v_prize_gap term and its whole ledger
-- conjunction appear character for character in 20261107143600, the detector's
-- own migration. If either side is edited without the other, that law fails.
--
-- THE TWIN IS UPGRADED, NOT INHERITED FROM. For each alert this run actually
-- closes - and only for those, re-measured again on their own account under
-- the twin UPDATE - the twin incident's closure_basis is moved from
-- 'aged_out_unverified' to 'verified_remeasured', its correction_ref restated
-- under the 'verified: ' prefix that fn_ca_resolution_needs_a_cause fences off
-- from 'aged-out: ', and its root_cause stops saying "Never established",
-- because now it is. The superseded wording is kept verbatim in metadata, so
-- nothing is destroyed. status and resolved_at are deliberately NOT touched:
-- the incident is already resolved, and zz_ca_incident_resolution_reaches_the_alerts
-- fires on status alone, so this upgrade cannot propagate a closure to any
-- other alert. An aged-out closure is REPLACED by evidence; it is never read
-- as evidence.
--
-- PROVEN IN AN EXPLICITLY ROLLED-BACK PRODUCTION TRANSACTION, 2026-11-07.
-- The postimage was installed, read back byte-identical at md5
-- 35fa1bb339f52b4411302d52b979c538, and then:
--   - preview (p_apply false) named exactly 26 alerts and nothing else - the
--     same 26 that are open on this source, no more and no fewer;
--   - apply closed those 26 and upgraded exactly 26 twins to
--     verified_remeasured;
--   - a second apply in the same transaction closed 0 and upgraded 0;
--   - NEGATIVE 1, a gap that is not all in the prize bank: a fabricated owner
--     retirement transfer moved the shadow of a clean terminally closed event
--     by 777.00 chips on its BOUNTY side, giving v_diff 777.00 with
--     v_prize_gap 0.00; its alert STAYED OPEN;
--   - NEGATIVE 2, the ledger row absent: the same fabrication on the PRIZE
--     side gave v_diff 777.00 with v_prize_gap 777.00 and no owner correction
--     leg; its alert STAYED OPEN;
--   - NEGATIVE 3, the ledger row present with the wrong amount: the same
--     fabrication against 6b72abc3 moved its measured gap off the 950.00 the
--     real leg carries; its alert STAYED OPEN;
-- then ROLLBACK, after which pg_get_functiondef still read the preimage md5
-- dcbc68f86ca771e9c97f86add77b2ccd, the 26 alerts were still open, all 26
-- twins still read aged_out_unverified, and no row of any table had changed.
--
-- GUARDS, as class 7: refuses inside the break window; the live body must be
-- the exact preimage or already the postimage; owner, SECURITY DEFINER,
-- search_path, ACL and overload count are checked before and after; the
-- embedded postimage must hash to the md5 proven above; the readback must be
-- byte-identical to it; the service-role-only grant is restated and read back.
-- CLASSES 1-7 ARE BYTE-FOR-BYTE UNCHANGED: the postimage is the live body
-- (dcbc68f86ca771e9c97f86add77b2ccd) with three declarations, one new class
-- and two new return keys added, and one 'total' line extended - 282 lines
-- added, one line replaced, nothing else touched.
-- This migration closes no alert itself; the next resolver run does.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))) = '35fa1bb339f52b4411302d52b979c538'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'FALSE_ESCROW_DRIFT_ALERT_CLOSER_REFUSED: %', v_reason USING ERRCODE = '55000';
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
  v_drift     integer := 0;
  v_drift_ids uuid[] := '{}';
  v_twins     integer := 0;
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

  -- CLASS 8: an escrow DRIFT ALERT that a fresh re-measure refutes.
  -- fn_ca_escrow_balance_drift filed 26 alerts that are false, and nothing
  -- could ever retire them: every one of the 26 escrow rows carries
  -- terminal_closed_at, so no write can reach them again, and 35,479 escrow
  -- rows are newer than the oldest of them, so the sweep's own
  -- ORDER BY updated_at DESC LIMIT 5000 window can never see them either.
  -- The detector fix of 2026-11-07 stops the NEXT one being filed; only a
  -- closer can clear the ones already on the board.
  --
  -- THE TWIN INCIDENTS ARE NOT THE EVIDENCE AND ARE NEVER READ AS SUCH. All
  -- 26 ca_drift_incidents rows behind these alerts are already status
  -- 'resolved' with closure_basis 'aged_out_unverified' - retired because the
  -- source went quiet, which establishes nothing (law 10.86 rule 1, and the
  -- reason fn_ca_incident_resolution_reaches_the_alerts refuses to propagate
  -- an age-out in the first place). Across the whole drift_incident:* family
  -- on 2026-11-07 there were 46 unresolved alerts against 42 closed twins, of
  -- which only 3 were verified_remeasured and 39 were aged_out_unverified: a
  -- closer that inherited incident closure would shut 39 alerts on silence.
  -- So this class reads NEITHER resolved, NOR resolved_at, NOR closure_basis,
  -- NOR any elapsed time: it names no time window and does no clock
  -- arithmetic of any kind. It measures the live quantity again, per alert,
  -- and closes only what the measurement itself refutes.
  --
  -- WHAT IS RE-MEASURED is the detector's own quantity, written the same way
  -- it writes it: v_diff, what this escrow row holds across its three banks
  -- less what the chip shadow says it should hold, and v_prize_gap, the part
  -- of that sitting in the prize bank. Two terms close an alert:
  --   (A) v_diff = 0 - the escrow conserves exactly. 25 of the 26 are this:
  --       one sweep tick at 2026-11-03 12:35:00.159115+00 filed 25
  --       'settlement_error' incidents of 0.00 chips across 25 distinct
  --       CANCELLED Spins. The trip test is per bank, the amount filed is
  --       their sum, and on a fully refunded cancelled Spin two banks
  --       disagree by the same amount with opposite signs: the per-bank gaps
  --       re-measured 2026-11-07 are 0.24, 0.48, 0.72, 1.20, 2.40, 4.80,
  --       12.00 and 24.00 chips, each exactly 8% of that event's gross, and
  --       every total is 0.00. A settlement error of zero chips is not a
  --       settlement error. The bank-split disagreement is a defect of the
  --       shadow for whoever reconciles rake_records against the escrow, not
  --       a finding of this detector.
  --   (B) v_diff <> 0, the whole gap sits in the prize bank, and chip_ledger
  --       carries the owner-authorized bounty/guarantee correction that
  --       accounts for it: the tournament-scoped owner_bounty_guarantee
  --       idempotency key, category 'reversal', prize_liability (this
  --       tournament) -> union_bank with a destination, metadata kind
  --       'owner_bounty_guarantee_correction', both journalled row images,
  --       the owner instruction, and round(l.amount, 2) = - v_diff. 1 of the
  --       26 is this: -950.00 at 2026-11-02 06:35:00.134568+00. A movement
  --       that is journalled is accounted for, not drift. No tournament id is
  --       hard-coded: a correction whose ledger row is absent, of another
  --       kind, of another direction, of another amount, or landing outside
  --       the prize bank is still a finding and its alert STAYS OPEN.
  -- These are the live detector's own two exclusions, written in its own
  -- terms, so the closer and the detector agree on what a finding is. They
  -- are NOT shared through one helper function: the detector re-reads its
  -- escrow row immediately before the shadow so both reads are milliseconds
  -- apart (its 2026-09-05 same-instant guarantee), and a boolean helper doing
  -- its own reads would give the loop two measurements taken at different
  -- instants - and the helper would have to name the shadow chips function,
  -- which would park tests/attention-items-close-at-their-roots.law.test.ts
  -- on this file. tests/an-escrow-drift-alert-closes-on-a-re-measurement.law.test.ts
  -- pins the two to each other textually instead.
  --
  -- terminal_closed_at IS NOT NULL is required, so the measurement is final
  -- rather than momentary. Proven 2026-11-07 in a rolled-back production
  -- transaction: once an escrow is terminally closed, BOTH sides of the
  -- measurement are immutable - the escrow row by
  -- fn_terminal_tournament_escrow_is_immutable, and every table the shadow
  -- reads by the terminal-evidence guards (tournament_rake_settlements and
  -- tournament_refund_tranches both refuse an insert with "terminal
  -- tournament ... has immutable ... evidence"). A live escrow could read 0
  -- this second and drift the next; a terminally closed one cannot.
  -- The predicate is repeated verbatim under the UPDATE. CLASSES 1-7 ARE
  -- BYTE-FOR-BYTE UNCHANGED.
  SELECT COALESCE(array_agg(id), '{}') INTO v_drift_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.tournament_escrow r
        ON r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
      CROSS JOIN LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e
      CROSS JOIN LATERAL (
        SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
               round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_drift := COALESCE(array_length(v_drift_ids, 1), 0);

  IF p_apply THEN
    -- The whole predicate again under UPDATE: a preview is not authority.
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = CASE WHEN g.v_diff = 0
               THEN 'verified: re-measured, the escrow of tournament ' || r.tournament_id::text
                 || ' conserves exactly - its three banks hold '
                 || round(r.prize_balance + r.bounty_balance + r.fee_balance, 2)::text
                 || ' against a shadow of '
                 || round(e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance, 2)::text
                 || ', a measured discrepancy of 0.00 chips, on an escrow terminally closed at '
                 || r.terminal_closed_at::text
                 || '. The detector filed a zero-chip settlement error on a conserving escrow: the per-bank gap of '
                 || g.v_prize_gap::text
                 || ' chips is the chip shadow disagreeing with itself across two banks, and it cancels.'
               ELSE 'verified: re-measured, the whole measured gap of ' || g.v_diff::text
                 || ' chips on tournament ' || r.tournament_id::text
                 || ' sits in the prize bank, and chip_ledger accounts for it under idempotency key '
                 || COALESCE((SELECT l.idempotency_key FROM public.chip_ledger l
                      WHERE l.tournament_id = r.tournament_id
                        AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                        AND l.category = 'reversal'
                        AND l.from_type = 'prize_liability'
                        AND l.from_entity_id = r.tournament_id
                        AND l.to_type = 'union_bank'
                        AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                        AND round(l.amount, 2) = - g.v_diff
                      ORDER BY l.created_at, l.id LIMIT 1), '(none)')
                 || ' - the owner-authorized bounty/guarantee correction out of prize_liability to the union bank. A movement that is journalled is accounted for, not drift.'
               END,
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'escrow_drift_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'kind', CASE WHEN g.v_diff = 0 THEN 'conserving_escrow_zero_discrepancy'
                              ELSE 'journal_bound_owner_correction' END,
                 'tournament_id', r.tournament_id,
                 'measured_discrepancy', g.v_diff,
                 'prize_bank_gap', g.v_prize_gap,
                 'escrow_banks', jsonb_build_object('prize', r.prize_balance,
                   'bounty', r.bounty_balance, 'fee', r.fee_balance),
                 'shadow_banks', jsonb_build_object(
                   'prize', e.prize_balance - r.reserve_out + r.reserve_in,
                   'bounty', e.bounty_balance, 'fee', e.fee_balance),
                 'escrow_terminal_closed_at', r.terminal_closed_at,
                 'owner_correction_key', (SELECT l.idempotency_key FROM public.chip_ledger l
                      WHERE l.tournament_id = r.tournament_id
                        AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                        AND l.category = 'reversal'
                        AND l.from_type = 'prize_liability'
                        AND l.from_entity_id = r.tournament_id
                        AND l.to_type = 'union_bank'
                        AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                        AND round(l.amount, 2) = - g.v_diff
                      ORDER BY l.created_at, l.id LIMIT 1)))
        FROM public.tournament_escrow r,
             LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e,
             LATERAL (
               SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
                      round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
       WHERE a.id = ANY(v_drift_ids)
         AND a.resolved IS NOT TRUE
       AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
       AND r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_drift_ids FROM changed;
    v_drift := COALESCE(array_length(v_drift_ids, 1), 0);

    -- AN AGED-OUT CLOSURE IS REPLACED BY EVIDENCE, NEVER INHERITED FROM. The
    -- twin incident was retired on silence and says so in its own words
    -- ("NOTHING WAS RE-MEASURED"). Now something has been re-measured, so the
    -- twin is restated: closure_basis becomes 'verified_remeasured',
    -- correction_ref carries the measurement under the 'verified: ' prefix
    -- that fn_ca_resolution_needs_a_cause fences off from 'aged-out: ', and
    -- root_cause stops saying "Never established". The superseded text is
    -- kept verbatim in metadata, so nothing is destroyed. status and
    -- resolved_at are deliberately NOT touched: the incident was already
    -- resolved, and zz_ca_incident_resolution_reaches_the_alerts fires on
    -- status alone, so this upgrade cannot propagate a closure to any other
    -- alert. Only twins of alerts this run actually closed, re-measured here
    -- again on their own account, are upgraded.
    WITH twins AS (
      UPDATE public.ca_drift_incidents d
         SET closure_basis = 'verified_remeasured',
             root_cause = CASE WHEN g.v_diff = 0
               THEN 'Established by re-measurement, not by silence: this event''s escrow conserves exactly - a measured discrepancy of 0.00 chips across its three banks on an escrow that is terminally closed and can no longer move. fn_ca_escrow_balance_drift trips per bank and files the SUM as the discrepancy, so a chip shadow that disagrees with itself across two banks by the same amount with opposite signs produced a settlement error of zero chips.'
               ELSE 'Established by re-measurement, not by silence: the whole measured gap of ' || g.v_diff::text || ' chips sits in the prize bank, and chip_ledger carries the owner-authorized bounty/guarantee correction that moved exactly that amount out of prize_liability to the union bank. The maintained escrow saw that leg and the chip shadow does not count it, so the row reads low by the amount of the leg. A movement that is journalled is accounted for, not drift.' END,
             correction_ref = 'verified: re-measured by fn_resolve_settled_financial_alerts class 8 at '
               || now()::text || '; measured discrepancy ' || g.v_diff::text
               || ' chips, prize-bank gap ' || g.v_prize_gap::text
               || ' chips, escrow terminally closed at ' || r.terminal_closed_at::text,
             resolution = 'RE-MEASURED AND CLEARED. This closure REPLACES an aged-out one: the incident had been retired only because fn_ca_escrow_balance_drift stopped reporting it, which establishes nothing. The quantity has now been measured again, per alert, against the live escrow row and its chip shadow - measured discrepancy '
               || g.v_diff::text || ' chips, prize-bank gap ' || g.v_prize_gap::text
               || ' chips - and the finding is refuted on its own terms, not by elapsed time. The superseded aged-out wording is kept in metadata. NO CHIPS MOVED.',
             metadata = COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object(
               'escrow_drift_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'upgraded_by', 'fn_resolve_settled_financial_alerts',
                 'upgraded_on', now(),
                 'financial_alert_id', a.id,
                 'measured_discrepancy', g.v_diff,
                 'prize_bank_gap', g.v_prize_gap,
                 'superseded_closure_basis', d.closure_basis,
                 'superseded_correction_ref', d.correction_ref,
                 'superseded_resolution', d.resolution,
                 'superseded_root_cause', d.root_cause))
        FROM public.financial_alerts a, public.tournament_escrow r,
             LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e,
             LATERAL (
               SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
                      round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
       WHERE a.id = ANY(v_drift_ids)
         AND a.resolved IS TRUE
         AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
         AND a.context->>'incident_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         AND d.id = (a.context->>'incident_id')::uuid
         AND d.source = 'fn_ca_escrow_balance_drift'
         AND d.classification = 'settlement_error'
         AND d.status = 'resolved'
         AND d.closure_basis = 'aged_out_unverified'
         AND d.tournament_id = r.tournament_id
         AND r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
      RETURNING d.id
    )
    SELECT COALESCE(count(*), 0)::integer INTO v_twins FROM twins;
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
    'escrow_drift_false_positive_closed', v_drift,
    'escrow_drift_incident_twins_upgraded', v_twins,
    'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk + v_drift,
    'still_unresolved', (SELECT count(*) FROM public.financial_alerts WHERE resolved IS NOT TRUE)
  );
END;
$function$
$post$;
  v_actual text;
BEGIN
  IF current_user <> 'postgres' OR v_oid IS NULL
     OR md5(v_post) <> '35fa1bb339f52b4411302d52b979c538' THEN
    RAISE EXCEPTION 'false escrow drift alert closer: owner/target/embedded postimage mismatch';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
          AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
          AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
          AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname = 'fn_resolve_settled_financial_alerts') <> 1 THEN
    RAISE EXCEPTION 'false escrow drift alert closer: target authority/overload drift before';
  END IF;
  v_actual := pg_get_functiondef(v_oid);
  IF md5(v_actual) = '35fa1bb339f52b4411302d52b979c538' THEN
    RETURN;
  END IF;
  IF md5(v_actual) <> 'dcbc68f86ca771e9c97f86add77b2ccd' THEN
    RAISE EXCEPTION 'false escrow drift alert closer: unexpected live body %', md5(v_actual);
  END IF;
  EXECUTE v_post;
  IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_post
     OR md5(pg_get_functiondef(v_oid)) <> '35fa1bb339f52b4411302d52b979c538' THEN
    RAISE EXCEPTION 'false escrow drift alert closer: exact postimage readback failed';
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
         AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[])
     OR md5(pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))
        <> '35fa1bb339f52b4411302d52b979c538' THEN
    RAISE EXCEPTION 'false escrow drift alert closer: authority drift after';
  END IF;
END
$acl$;

COMMIT;
