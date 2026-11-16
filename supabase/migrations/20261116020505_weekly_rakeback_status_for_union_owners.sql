-- 20261116020505_weekly_rakeback_status_for_union_owners
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-16 02:05:05 UTC.
--
-- WEEKLY RAKEBACK STATUS: ONE SCREEN FOR THE UNION OWNER (2026-11-15).
--
-- WHAT WAS MISSING. The Monday 04:00 America/Chicago weekly close pays in
-- three rounds (round 1 union -> club treasuries, round 2 agent commissions,
-- round 3 player and horse rakeback), then the union close issues one
-- union_weekly_squareup statement per club, delivers it, and 20261115205037
-- compares each statement with the Club Data screen. Every step leaves a
-- record, but in six different tables, two of them in smarter_private, so
-- the union owner had no single place to see where this week's payout stands.
--
-- WHAT THIS ADDS. ONE new read-only function,
-- public.ca_union_weekly_rakeback_status(p_union_id, p_period_end default
-- NULL = the most recent week, public.fn_union_week_start(now())). It returns
-- {union_id, period{start,end,time_zone,start_local,end_local,label},
-- scheduled_for, scheduled_for_local, in_progress, stages[], statements[],
-- last_updated, generated_at}. The accounting period runs from 2:00 AM
-- America/Chicago Monday to 2:00 AM America/Chicago the next Monday, and the
-- label names it with its zone, e.g. "Mon Nov 9, 2026 2:00 AM CST To Mon Nov
-- 16, 2026 2:00 AM CST (America/Chicago)". The seven stages are Preparation,
-- Clubs Paid, Agents Paid, Players Paid, Statements Sent, Invoices Match Club
-- Data and Books Closed, each {key, label, state, at, amount, count, detail,
-- scheduled_at, deadline_at, deadline_source, elapsed_seconds}.
--
-- STATES COME ONLY FROM RECORDS AND FROM DEADLINES THE SYSTEM ALREADY HAS.
--   done          a record says so (a round receipt, a delivery row for every
--                 club statement, a matching Club Data check for every club
--                 statement, a complete and successful book close row).
--   failed        a record says it failed (a released payout run whose result
--                 says success false / paid false / error; a Club Data check
--                 that differs or could not read the screen; a book close row
--                 with status 'failed').
--   late          ONLY past a deadline the payout code itself enforces:
--                   * a booked round-runner run's money_deadline_at (booked
--                     time + 20 hours, written by
--                     smarter_private.weekly_payout_next_round and applied to
--                     every round as app.weekly_accounting_scope_deadline);
--                   * the automatic payout window, run time + 24 hours: the
--                     round runner (cron job weekly-payout-rounds) returns
--                     NULL from then on, the slot path stops after its 24
--                     hourly slots and raises WeeklyPayoutUnpaidAfterLastSlot.
--                 A round's deadline is the earlier of the two once a run is
--                 booked, the window close before that.
--   running       a record shows the work under way (run phase 'paying' for
--                 the next unpaid round, a pausing run, a book close row with
--                 status 'running').
--   not_finished  past the run time, nothing recorded yet, and the stage has
--                 no deadline of its own (Statements Sent), or its deadline
--                 has not passed: shown with the run time and elapsed time.
--   not_checked   Invoices Match Club Data and Books Closed with no
--                 verification record for the week (never green by default).
--   waiting       before the run time.
-- No threshold is invented here: Statements Sent, Invoices Match Club Data
-- and Books Closed have no authoritative deadline, so they are never late.
--
-- SOURCES, all read with plain SELECTs:
--   weekly_accounting_payout_pauses (instance 'weekly-payout-rounds': phase,
--     money_starts_at, money_deadline_at, result->'rounds'),
--   union_settlement_rounds (the per-round receipt, written as each round
--     pays) and accounting_routed_settlement_runs (rounds 2 and 3),
--   rakeback_periods (the week's periods by status, union member clubs),
--   settlement_invoices union_weekly_squareup + union_weekly_credit_note with
--     accounting_invoice_deliveries (delivered = a delivery row exists, the
--     rule of 20261115151821),
--   smarter_private.weekly_invoice_club_data_checks (statement vs Club Data,
--     the row must name the statement shown),
--   union_accounting_runs (book close status, finished_at, result success).
-- Round figures are the union scope only, exactly as the owner notices of
-- 20261115205037 count them; receipts win over the pauses result.
--
-- WHO MAY CALL IT. Exactly the caller rule of the Union Statements board
-- reader public.ca_union_statement_board: IF NOT ca_can_oversee_union(
-- p_union_id) (auth.uid() is the union's overseer or a platform admin) raise
-- 42501 'not authorized for this union'. REVOKE from PUBLIC and anon, GRANT
-- to authenticated and service_role, as that reader.
--
-- SAFETY. Nothing existing is modified, replaced or wrapped. The function
-- only SELECTs (no FOR UPDATE / SHARE, no advisory lock, no write), so it
-- takes only ACCESS SHARE locks that cannot block the payout, and it runs
-- with statement_timeout 5s and lock_timeout 1s.
--
-- PRODUCTION RECORDS (read-only SELECTs, 2026-11-15/16) for the week ending
-- 2026-11-09 08:00Z: round receipts 840,213.67 to 3 clubs, 695.49 to 20
-- agents, 642,268.52 to 1,339 payees; statements MIDWAY-2026-000037..041
-- with the four club statements delivered (000040 is the union's own house
-- row, record-only); no Club Data check rows (the self-check started after
-- that week), so Invoices Match Club Data reads Not Checked Yet; book close
-- row complete, success true, finished 2026-11-11 09:06Z. This body was
-- proved only on the native PostgreSQL fixture, never run on production.
--
-- @live-proof: to_regprocedure('public.ca_union_weekly_rakeback_status(uuid,timestamp with time zone)') IS NOT NULL AND has_function_privilege('authenticated','public.ca_union_weekly_rakeback_status(uuid,timestamp with time zone)','EXECUTE') AND NOT has_function_privilege('anon','public.ca_union_weekly_rakeback_status(uuid,timestamp with time zone)','EXECUTE') AND position('ca_can_oversee_union(p_union_id)' IN pg_get_functiondef('public.ca_union_weekly_rakeback_status(uuid,timestamp with time zone)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='20s';

CREATE FUNCTION public.ca_union_weekly_rakeback_status(p_union_id uuid, p_period_end timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
 SET lock_timeout TO '1s'
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_end timestamptz;
  v_start timestamptz;
  v_due timestamptz;
  v_window_end timestamptz;
  v_day date;
  v_phase text;
  v_announced timestamptz;
  v_money_start timestamptz;
  v_money_deadline timestamptz;
  v_ack timestamptz;
  v_result jsonb;
  v_has_pz boolean := false;
  v_has_bk boolean := false;
  v_bk_status text;
  v_bk_attempts int;
  v_bk_started timestamptz;
  v_bk_finished timestamptz;
  v_bk_success text;
  rp record;
  st record;
  v_round record;
  v_r jsonb[] := ARRAY[NULL, NULL, NULL]::jsonb[];
  v_state text;
  v_detail text;
  v_at timestamptz;
  v_deadline timestamptz;
  v_deadline_source text;
  v_elapsed bigint;
  v_prev_done boolean;
  v_paying boolean;
  v_failed_run boolean;
  v_stages jsonb := '[]'::jsonb;
  v_statements jsonb;
  v_round_labels text[] := ARRAY['Clubs Paid','Agents Paid','Players Paid'];
  v_round_keys text[] := ARRAY['clubs_paid','agents_paid','players_paid'];
  v_round_noun text[] := ARRAY['Club','Agent','Payee'];
  v_window_source text := 'Automatic Payout Window Closes (Run Time Plus 24 Hours)';
  v_all_done boolean;
  v_any_running boolean;
  v_last timestamptz;
  v_start_local text;
  v_end_local text;
  v_out jsonb;
BEGIN
  IF NOT ca_can_oversee_union(p_union_id) THEN
    RAISE EXCEPTION 'not authorized for this union' USING ERRCODE = '42501';
  END IF;

  v_end := COALESCE(p_period_end, fn_union_week_start(v_now));
  v_start := fn_union_week_start(v_end - interval '1 day');
  v_due := fn_union_accounting_run_at(v_end);
  v_window_end := v_due + interval '24 hours';
  v_day := fn_ca_accounting_day(v_start);
  v_elapsed := CASE WHEN v_now >= v_due THEN floor(extract(epoch FROM v_now - v_due))::bigint END;

  -- The week's payout run (the newest attempt of the round runner).
  SELECT p.phase, p.announced_at, p.money_starts_at, p.money_deadline_at, p.acknowledged_at, p.result
    INTO v_phase, v_announced, v_money_start, v_money_deadline, v_ack, v_result
    FROM weekly_accounting_payout_pauses p
   WHERE p.period_end = v_end AND p.instance_id = 'weekly-payout-rounds'
   ORDER BY p.attempt_no DESC NULLS LAST, p.created_at DESC
   LIMIT 1;
  v_has_pz := FOUND;
  v_paying := v_has_pz AND v_phase = 'paying';
  v_failed_run := v_has_pz AND v_phase = 'released'
    AND COALESCE(v_result->>'success' = 'false' OR v_result->>'paid' = 'false' OR v_result ? 'error', false);

  -- Each round: the receipt first, then the routed run, then the run result.
  FOR i IN 1..3 LOOP
    SELECT z.amount, z.payees, z.at INTO v_round FROM (
      SELECT s.amount, s.payees::bigint AS payees, s.executed_at AS at, 1 AS pri
        FROM union_settlement_rounds s
       WHERE s.union_id = p_union_id AND s.period_end = v_end AND s.round_no = i
      UNION ALL
      SELECT CASE WHEN r.result->>'amount' ~ '^-?\d+(\.\d+)?$' THEN (r.result->>'amount')::numeric END,
             CASE WHEN r.result->>'payees' ~ '^\d{1,15}$' THEN (r.result->>'payees')::bigint END,
             r.completed_at, 2
        FROM accounting_routed_settlement_runs r
       WHERE r.period_end = v_end AND r.round_no = i AND r.scope_kind = 'union' AND r.scope_id = p_union_id
         AND r.completed_at IS NOT NULL AND COALESCE(r.result->>'success', 'true') <> 'false'
      UNION ALL
      SELECT CASE WHEN x->>'amount' ~ '^-?\d+(\.\d+)?$' THEN (x->>'amount')::numeric END,
             CASE WHEN x->>'payees' ~ '^\d{1,15}$' THEN (x->>'payees')::bigint END,
             CASE WHEN p.result->>'financial_finished_at' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$'
                  THEN (p.result->>'financial_finished_at')::timestamptz ELSE p.created_at END, 3
        FROM weekly_accounting_payout_pauses p
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.result->'rounds') = 'array'
          THEN p.result->'rounds' ELSE '[]'::jsonb END) x
       WHERE p.period_end = v_end AND p.instance_id = 'weekly-payout-rounds'
         AND jsonb_typeof(x) = 'object' AND x->>'scope_kind' = 'union' AND x->>'scope_id' = p_union_id::text
         AND x->>'round' = i::text
    ) z ORDER BY z.pri, z.at DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      v_r[i] := jsonb_build_object('amount', round(COALESCE(v_round.amount, 0), 2),
                                   'payees', COALESCE(v_round.payees, 0), 'at', v_round.at);
    END IF;
  END LOOP;

  -- The week's rakeback periods for the union's member clubs.
  SELECT count(*) AS n,
         count(*) FILTER (WHERE r.status = 'paid') AS paid,
         count(*) FILTER (WHERE r.status = 'pending') AS pending
    INTO rp
    FROM rakeback_periods r
   WHERE r.period_start = v_day
     AND (r.club_id = p_union_id
          OR r.club_id IN (SELECT uc.club_id FROM union_clubs uc WHERE uc.union_id = p_union_id));

  -- 1. Preparation. Deadline: the automatic payout window.
  v_deadline := v_window_end;
  v_deadline_source := v_window_source;
  v_at := NULL;
  IF v_has_pz AND v_phase <> 'draining' THEN
    v_state := 'done';
    v_detail := 'Payout Run Booked';
    v_at := COALESCE(v_ack, v_money_start, v_announced);
  ELSIF v_r[1] IS NOT NULL THEN
    v_state := 'done';
    v_detail := 'Payout Released';
    v_at := (v_r[1]->>'at')::timestamptz;
  ELSIF v_has_pz THEN
    v_state := 'running';
    v_detail := 'Pausing Games Before The Payout';
    v_at := v_announced;
  ELSIF v_now < v_due THEN
    v_state := 'waiting';
    v_detail := 'Starts At The Scheduled Run Time';
  ELSIF v_now >= v_deadline THEN
    v_state := 'late';
    v_detail := 'No Payout Run Was Booked Before The Automatic Payout Window Closed';
  ELSE
    v_state := 'not_finished';
    v_detail := 'Not Finished Yet: No Payout Run Booked';
  END IF;
  v_stages := v_stages || jsonb_build_object('key', 'preparation', 'label', 'Preparation', 'state', v_state,
    'at', v_at, 'amount', NULL, 'count', rp.n,
    'detail', v_detail || ' (' || to_char(rp.n, 'FM999,999,990') || ' Rakeback Periods)',
    'scheduled_at', v_due, 'deadline_at', v_deadline, 'deadline_source', v_deadline_source,
    'elapsed_seconds', CASE WHEN v_state IN ('done', 'waiting') THEN NULL ELSE v_elapsed END);

  -- 2-4. The three payment rounds. Deadline: the booked run's money deadline,
  -- never later than the automatic payout window; the window before booking.
  IF v_has_pz AND v_money_deadline IS NOT NULL AND v_money_deadline < v_window_end THEN
    v_deadline := v_money_deadline;
    v_deadline_source := 'Payout Run Money Deadline (Booked Time Plus 20 Hours)';
  ELSE
    v_deadline := v_window_end;
    v_deadline_source := v_window_source;
  END IF;
  v_prev_done := true;
  FOR i IN 1..3 LOOP
    v_at := NULL;
    IF v_r[i] IS NOT NULL THEN
      v_state := 'done';
      v_at := (v_r[i]->>'at')::timestamptz;
      v_detail := to_char((v_r[i]->>'payees')::bigint, 'FM999,999,990') || ' '
        || v_round_noun[i] || CASE WHEN (v_r[i]->>'payees')::bigint = 1 THEN '' ELSE 's' END || ' Paid';
      IF i = 3 AND rp.n > 0 THEN
        v_detail := v_detail || ' (' || to_char(rp.paid, 'FM999,999,990') || ' Of '
          || to_char(rp.n, 'FM999,999,990') || ' Rakeback Periods Paid)';
      END IF;
    ELSIF v_failed_run THEN
      v_state := 'failed';
      v_detail := 'The Payout Run Recorded A Failure Before This Round';
    ELSIF v_now >= v_deadline THEN
      v_state := 'late';
      v_detail := 'Not Paid By ' || to_char(v_deadline AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM')
        || ' Chicago Time';
    ELSIF v_paying AND v_prev_done THEN
      v_state := 'running';
      v_detail := 'Paying Now';
    ELSIF v_now < v_due THEN
      v_state := 'waiting';
      v_detail := CASE WHEN i = 1 THEN 'Waiting For The Payout To Start' ELSE 'Waiting For ' || v_round_labels[i - 1] END;
    ELSE
      v_state := 'not_finished';
      v_detail := CASE WHEN v_prev_done THEN 'Not Finished Yet' ELSE 'Not Finished Yet: Waiting For ' || v_round_labels[i - 1] END;
    END IF;
    v_prev_done := v_r[i] IS NOT NULL;
    v_stages := v_stages || jsonb_build_object('key', v_round_keys[i], 'label', v_round_labels[i], 'state', v_state,
      'at', v_at, 'amount', v_r[i]->'amount', 'count', v_r[i]->'payees', 'detail', v_detail,
      'scheduled_at', v_due, 'deadline_at', v_deadline, 'deadline_source', v_deadline_source,
      'elapsed_seconds', CASE WHEN v_state IN ('done', 'waiting') THEN NULL ELSE v_elapsed END);
  END LOOP;

  -- The week's statements (house row included and marked) with credit notes.
  WITH s AS (
    SELECT DISTINCT ON (i.club_id) i.id, i.club_id, i.invoice_number, i.net_amount, i.status,
           i.breakdown->>'direction' AS direction, i.created_at
      FROM settlement_invoices i
     WHERE i.invoice_type = 'union_weekly_squareup'
       AND i.breakdown->>'union_id' = p_union_id::text
       AND CASE WHEN i.breakdown->>'period_end' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$'
                THEN (i.breakdown->>'period_end')::timestamptz END = v_end
     ORDER BY i.club_id, i.created_at DESC, i.id
  ), d AS (
    SELECT s.*, c.name AS club_name, (s.club_id = p_union_id) AS house,
           (SELECT max(x.delivered_at) FROM accounting_invoice_deliveries x WHERE x.invoice_id = s.id) AS delivered_at,
           EXISTS (SELECT 1 FROM accounting_invoice_deliveries x WHERE x.invoice_id = s.id) AS delivered,
           k.matches, k.read_error, k.checked_at, (k.invoice_id IS NOT NULL) AS checked
      FROM s
      LEFT JOIN clubs c ON c.id = s.club_id
      LEFT JOIN smarter_private.weekly_invoice_club_data_checks k
        ON k.period_end = v_end AND k.club_id = s.club_id AND k.invoice_id = s.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'number', d.invoice_number, 'club', d.club_name, 'club_id', d.club_id, 'house', d.house,
           'direction', d.direction, 'amount', round(COALESCE(d.net_amount, 0), 2), 'status', d.status,
           'delivered', d.delivered, 'delivered_at', d.delivered_at,
           'matches_club_data', CASE WHEN NOT d.checked THEN NULL WHEN d.read_error IS NOT NULL THEN false ELSE d.matches END,
           'checked_at', d.checked_at,
           'credit_notes', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('number', cn.invoice_number, 'amount', round(cn.net_amount, 2),
                      'delivered', EXISTS (SELECT 1 FROM accounting_invoice_deliveries x WHERE x.invoice_id = cn.id))
                    ORDER BY cn.created_at, cn.invoice_number)
               FROM settlement_invoices cn
              WHERE cn.adjusts_invoice_id = d.id AND cn.invoice_type = 'union_weekly_credit_note'
                AND COALESCE(cn.status, '') <> 'cancelled'), '[]'::jsonb))
           ORDER BY d.invoice_number, d.club_id), '[]'::jsonb) AS list,
         count(*) FILTER (WHERE NOT d.house) AS n,
         count(*) FILTER (WHERE NOT d.house AND d.delivered) AS delivered,
         max(d.delivered_at) FILTER (WHERE NOT d.house) AS delivered_at,
         count(*) FILTER (WHERE NOT d.house AND d.checked) AS checked,
         count(*) FILTER (WHERE NOT d.house AND d.checked AND d.matches IS TRUE AND d.read_error IS NULL) AS ok,
         count(*) FILTER (WHERE NOT d.house AND d.checked AND d.read_error IS NULL AND d.matches IS FALSE) AS mismatched,
         count(*) FILTER (WHERE NOT d.house AND d.checked AND d.read_error IS NOT NULL) AS unread,
         max(d.checked_at) FILTER (WHERE NOT d.house AND d.checked) AS checked_at,
         string_agg(CASE WHEN NOT d.house AND d.checked AND d.read_error IS NULL AND d.matches IS FALSE
                         THEN COALESCE(d.club_name, d.invoice_number) END, ', ' ORDER BY d.invoice_number) AS differ,
         string_agg(CASE WHEN NOT d.house AND d.checked AND d.read_error IS NOT NULL
                         THEN COALESCE(d.club_name, d.invoice_number) END, ', ' ORDER BY d.invoice_number) AS unread_names
    INTO st
    FROM d;
  v_statements := st.list;

  -- 5. Statements Sent (club statements; the house row is record-only). No
  -- authoritative deadline: never late.
  v_at := NULL;
  IF st.n > 0 AND st.delivered = st.n THEN
    v_state := 'done';
    v_detail := st.delivered || ' Of ' || st.n || ' Club Statements Delivered';
    v_at := st.delivered_at;
  ELSIF v_now < v_due AND st.n = 0 THEN
    v_state := 'waiting';
    v_detail := 'Statements Are Issued After The Payout';
  ELSE
    v_state := 'not_finished';
    v_detail := 'Not Finished Yet: ' || CASE WHEN st.n = 0 THEN 'No Statements Issued Yet'
      ELSE st.delivered || ' Of ' || st.n || ' Club Statements Delivered' END;
  END IF;
  v_stages := v_stages || jsonb_build_object('key', 'statements_sent', 'label', 'Statements Sent', 'state', v_state,
    'at', v_at, 'amount', NULL, 'count', st.delivered, 'detail', v_detail,
    'scheduled_at', v_due, 'deadline_at', NULL, 'deadline_source', NULL,
    'elapsed_seconds', CASE WHEN v_state IN ('done', 'waiting') THEN NULL ELSE v_elapsed END);

  -- 6. Invoices Match Club Data: only the check rows decide.
  v_at := CASE WHEN st.checked > 0 THEN st.checked_at END;
  IF st.mismatched + st.unread > 0 THEN
    v_state := 'failed';
    v_detail := concat_ws('. ',
      CASE WHEN st.mismatched > 0 THEN 'Differs From Club Data: ' || st.differ END,
      CASE WHEN st.unread > 0 THEN 'Club Data Could Not Be Read: ' || st.unread_names END);
  ELSIF st.n > 0 AND st.ok = st.n THEN
    v_state := 'done';
    v_detail := st.ok || ' Of ' || st.n || ' Club Statements Match';
  ELSE
    v_state := 'not_checked';
    v_detail := 'Not Checked Yet' || CASE WHEN st.n = 0 THEN ': No Club Statements Issued Yet'
      ELSE ': ' || st.checked || ' Of ' || st.n || ' Club Statements Checked' END;
  END IF;
  v_stages := v_stages || jsonb_build_object('key', 'invoices_match', 'label', 'Invoices Match Club Data', 'state', v_state,
    'at', v_at, 'amount', NULL, 'count', st.ok, 'detail', v_detail,
    'scheduled_at', v_due, 'deadline_at', NULL, 'deadline_source', NULL,
    'elapsed_seconds', CASE WHEN v_state IN ('done', 'waiting') THEN NULL ELSE v_elapsed END);

  -- 7. Books Closed: only the union's book close row decides.
  SELECT a.status, a.attempts, a.started_at, a.finished_at, a.result->>'success'
    INTO v_bk_status, v_bk_attempts, v_bk_started, v_bk_finished, v_bk_success
    FROM union_accounting_runs a
   WHERE a.period_end = v_end AND a.scope_kind = 'union' AND a.scope_id = p_union_id
   ORDER BY a.finished_at DESC NULLS FIRST
   LIMIT 1;
  v_has_bk := FOUND;
  IF v_bk_status = 'complete' AND v_bk_finished IS NOT NULL AND v_bk_success = 'true' THEN
    v_state := 'done';
    v_detail := 'Week Closed';
    v_at := v_bk_finished;
  ELSIF v_bk_status = 'failed' THEN
    v_state := 'failed';
    v_detail := 'The Last Close Attempt Failed (' || COALESCE(v_bk_attempts, 0) || ' Attempts)';
    v_at := COALESCE(v_bk_finished, v_bk_started);
  ELSIF v_bk_status = 'running' THEN
    v_state := 'running';
    v_detail := 'Closing The Week';
    v_at := v_bk_started;
  ELSE
    v_state := 'not_checked';
    v_detail := CASE WHEN v_has_bk THEN 'Not Checked Yet: The Close Record Does Not Show A Successful Close'
      ELSE 'Not Checked Yet: No Book Close Record For This Week' END;
    v_at := v_bk_started;
  END IF;
  v_stages := v_stages || jsonb_build_object('key', 'books_closed', 'label', 'Books Closed', 'state', v_state,
    'at', v_at, 'amount', NULL, 'count', NULL, 'detail', v_detail,
    'scheduled_at', v_due, 'deadline_at', NULL, 'deadline_source', NULL,
    'elapsed_seconds', CASE WHEN v_state IN ('done', 'waiting') THEN NULL ELSE v_elapsed END);

  SELECT bool_and(e->>'state' = 'done'), bool_or(e->>'state' = 'running'),
         max(CASE WHEN e->>'at' IS NOT NULL THEN (e->>'at')::timestamptz END)
    INTO v_all_done, v_any_running, v_last
    FROM jsonb_array_elements(v_stages) e;

  v_start_local := to_char(v_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD, YYYY FMHH12:MI AM')
    || CASE WHEN (v_start AT TIME ZONE 'America/Chicago') - (v_start AT TIME ZONE 'UTC') = interval '-5 hours'
            THEN ' CDT' ELSE ' CST' END;
  v_end_local := to_char(v_end AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD, YYYY FMHH12:MI AM')
    || CASE WHEN (v_end AT TIME ZONE 'America/Chicago') - (v_end AT TIME ZONE 'UTC') = interval '-5 hours'
            THEN ' CDT' ELSE ' CST' END;

  v_out := jsonb_build_object(
    'union_id', p_union_id,
    'period', jsonb_build_object('start', v_start, 'end', v_end, 'time_zone', 'America/Chicago',
      'start_local', v_start_local, 'end_local', v_end_local,
      'label', v_start_local || ' To ' || v_end_local || ' (America/Chicago)'),
    'scheduled_for', v_due,
    'scheduled_for_local', to_char(v_due AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD, YYYY FMHH12:MI AM')
      || CASE WHEN (v_due AT TIME ZONE 'America/Chicago') - (v_due AT TIME ZONE 'UTC') = interval '-5 hours'
              THEN ' CDT' ELSE ' CST' END,
    'in_progress', COALESCE(v_any_running, false)
      OR (v_now >= v_due AND v_now < v_window_end AND NOT COALESCE(v_all_done, false)),
    'stages', v_stages,
    'statements', v_statements,
    'last_updated', v_last,
    'generated_at', v_now);
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ca_union_weekly_rakeback_status(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ca_union_weekly_rakeback_status(uuid,timestamptz) TO authenticated,service_role;
COMMIT;
