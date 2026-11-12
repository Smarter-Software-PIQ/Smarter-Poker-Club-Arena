-- Weekly invoices quote recorded cash/tournament player results.
-- Full weekly net is informational; external unpaid balance and all payments stay unchanged.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='12s';

DO $pin$ BEGIN IF md5(pg_get_functiondef('smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)'::regprocedure))<>'e2af45bf39e2827bb4d22614a936e632' THEN RAISE EXCEPTION 'weekly_invoice_preimage_changed: union_eco_invoice_components'; END IF; END $pin$;

DO $pin$ BEGIN IF md5(pg_get_functiondef('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure))<>'1a1a070e6a32766db137af3817defc8a' THEN RAISE EXCEPTION 'weekly_invoice_preimage_changed: fn_union_issue_weekly_invoices'; END IF; END $pin$;

DO $pin$ BEGIN IF md5(pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure))<>'2d7fe1169eabafba8f7638e4df252661' THEN RAISE EXCEPTION 'weekly_invoice_preimage_changed: ca_union_statement_board'; END IF; END $pin$;

CREATE OR REPLACE FUNCTION smarter_private.union_eco_invoice_components(p_union uuid, p_club uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE components jsonb;n integer;total numeric; cash_loss numeric; tournament_loss numeric; rakeback numeric;
BEGIN
 SELECT count(*),sum(amount),jsonb_agg(jsonb_build_object('activity',activity,'enabled',enabled,'base_mode',base_mode,
  'base',base,'rate',rate,'amount',amount,'terms_id',terms_id,'record_id',id,'status','recorded')ORDER BY activity)
 INTO n,total,components FROM smarter_private.union_eco_components WHERE union_id=p_union AND club_id=p_club AND period_start=p_start AND period_end=p_end;
 IF n=0 THEN RETURN jsonb_build_object('eco_version',1,'eco_components',NULL,'eco_components_complete',false);END IF;
 IF n<>2 OR EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=p_union AND club_id=p_club AND period_start=p_start AND period_end=p_end
  AND(amount IS DISTINCT FROM CASE WHEN enabled THEN round(-base*rate,2)ELSE 0 END OR base::text IN('NaN','Infinity','-Infinity')
   OR rate IS NULL OR rate<0 OR rate>1 OR terms_id IS NULL
   OR base IS DISTINCT FROM public.fn_pnl_evidence_cents(basis#>ARRAY['facts',activity,'rake_earned'])-public.fn_pnl_evidence_cents(basis#>ARRAY['facts',activity,'player_pnl'])
   OR basis_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex')))THEN
  RAISE EXCEPTION 'union_squareup_eco_activity_record_fails_its_own_arithmetic' USING ERRCODE='23514';END IF;
 -- Each activity quotes its immutable original facts, never current terms or wallets.
 SELECT -public.fn_pnl_evidence_cents(basis#>'{facts,cash,player_pnl}'),
        -public.fn_pnl_evidence_cents(basis#>'{facts,tournament,player_pnl}'),
        public.fn_pnl_evidence_cents(basis#>'{facts,cash,rake_earned}')+
        public.fn_pnl_evidence_cents(basis#>'{facts,tournament,rake_earned}')
 INTO cash_loss,tournament_loss,rakeback FROM smarter_private.union_eco_components
 WHERE union_id=p_union AND club_id=p_club AND period_start=p_start AND period_end=p_end
 ORDER BY activity LIMIT 1;
 IF cash_loss IS NULL OR tournament_loss IS NULL OR rakeback IS NULL OR rakeback<0
 OR EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=p_union AND club_id=p_club
  AND period_start=p_start AND period_end=p_end AND (
   -public.fn_pnl_evidence_cents(basis#>'{facts,cash,player_pnl}') IS DISTINCT FROM cash_loss
   OR -public.fn_pnl_evidence_cents(basis#>'{facts,tournament,player_pnl}') IS DISTINCT FROM tournament_loss
   OR public.fn_pnl_evidence_cents(basis#>'{facts,cash,rake_earned}')+
      public.fn_pnl_evidence_cents(basis#>'{facts,tournament,rake_earned}') IS DISTINCT FROM rakeback))
 THEN RAISE EXCEPTION 'union_invoice_original_player_results_disagree' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('weekly_player_results',jsonb_build_object(
  'version',1,'cash_net_loss',cash_loss,'tournament_net_loss',tournament_loss,
  'total_net_loss',cash_loss+tournament_loss,'rakeback_credit',rakeback,
  'eco_charge',-total,'weekly_net_due_to_union',cash_loss+tournament_loss-rakeback-total,
  'sign_convention','positive_club_owes_union'), 'eco_version',2,'eco_components',components,'eco_components_complete',true,'eco_amount',total);
END$function$
;

CREATE OR REPLACE FUNCTION public.fn_union_issue_weekly_invoices(p_union_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_from timestamptz := COALESCE(p_start, public.fn_union_prev_week_start(now()));
  v_to   timestamptz := COALESCE(p_end,   public.fn_union_week_start(now()));
  v_due  timestamptz;
  v_union_name text;
  r record;
  v_period_id uuid;
  v_invoice_id uuid;
  v_already_sent boolean;
  v_issued int := 0;
  v_notified int := 0;
  v_notified_batch int := 0;
  v_messaged int := 0;
  v_basis_exact boolean;
  v_msg jsonb;
  v_body text;
  v_number text;
  v_out jsonb := '[]'::jsonb;
  v_recorded_eco numeric;
  v_eco_recorded boolean;
  v_recorded_base numeric;
  v_recorded_rate numeric;
  v_components jsonb;
BEGIN
  IF v_caller IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unions u WHERE u.id = p_union_id AND u.owner_id = v_caller)
     AND NOT EXISTS (SELECT 1 FROM union_admins ua
                      WHERE ua.union_id = p_union_id AND ua.user_id = v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not authorized');
  END IF;

  -- Original owner/admin authorization above remains the first disclosure gate.
  PERFORM public.fn_require_union_pnl_evidence(p_union_id,v_from,v_to);

  /* THE GUARDS LIVE HERE, NOT ONLY IN THE CASCADE (Phase 6 verification,
     20260908). The Open Claw safety net calls this function directly. */
  IF EXISTS (SELECT 1 FROM public.union_settlement_floor f
              WHERE f.union_id = p_union_id AND v_from < f.earliest_period_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'before_settlement_floor',
                              'period_start', v_from, 'period_end', v_to);
  END IF;
  IF public.fn_union_setting(p_union_id, 'weekly_invoices_enabled', 1) <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'weekly_invoices_disabled',
                              'period_start', v_from, 'period_end', v_to);
  END IF;
  -- A statement says "rakeback already moved in chips". It is issued only for a
  -- period whose round 1 is final, and then it reads that round's own rows.
  IF NOT EXISTS (SELECT 1 FROM public.ca_settlements s
                  WHERE s.settlement_type = 'union_rakeback_close' AND s.union_id = p_union_id
                    AND s.state = 'final'
                    AND s.external_ref = p_union_id::text || ':'
                      || to_char(v_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '..'
                      || to_char(v_to   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'period_not_closed',
                              'period_start', v_from, 'period_end', v_to);
  END IF;

  v_due := v_to + interval '3 days';
  SELECT u.name INTO v_union_name FROM unions u WHERE u.id = p_union_id;

  -- Is the seated-stack baseline this week's ECO rests on an exact one?
  SELECT bool_and(COALESCE(e.baseline_cash_exact, false))
    INTO v_basis_exact
    FROM fn_union_eco_adjustment(p_union_id, v_from, v_to) e;
  v_basis_exact := COALESCE(v_basis_exact, false);

  FOR r IN SELECT * FROM fn_union_club_invoice(p_union_id, v_from, v_to) LOOP
    v_msg := NULL;
    v_invoice_id := NULL;
    v_already_sent := false;

    /* THE DOCUMENT QUOTES THE RECORDED ECO (2026-09-21). union_eco_ledger
       is the recorded ECO for this period; fn_union_eco_record wrote it
       earlier in this settlement. fn_union_club_invoice now reads it, so
       this refusal should never fire - it exists because a square-up that
       cannot quote its own record must STOP, not state a number. On
       2026-09-14 a second live recomputation billed club a41434bb 11244.03
       against a recorded -11242.82. With ECO terms disabled nothing is
       recorded and nothing may be stated. */
    v_components:=smarter_private.union_eco_invoice_components(p_union_id,r.club_id,v_from,v_to);
    IF smarter_private.union_eco_terms_for_book(p_union_id,v_from,v_to)IS NOT NULL AND v_components->>'eco_version'IS DISTINCT FROM '2'
      AND NOT EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=p_union_id AND club_id=r.club_id AND period_start=v_from AND period_end=v_to)THEN
      RAISE EXCEPTION 'union_squareup_eco_activity_records_required' USING ERRCODE='23514';END IF;
    IF v_components ? 'weekly_player_results' AND (
      (v_components#>>'{weekly_player_results,total_net_loss}')::numeric IS DISTINCT FROM -r.players_won
      OR (v_components#>>'{weekly_player_results,rakeback_credit}')::numeric IS DISTINCT FROM r.rakeback_due)
    THEN RAISE EXCEPTION 'union_invoice_original_player_results_disagree' USING ERRCODE='23514';END IF;
    IF v_components->>'eco_version'='2' THEN
      v_recorded_eco:=(v_components->>'eco_amount')::numeric;v_recorded_base:=NULL;v_recorded_rate:=NULL;v_eco_recorded:=true;
    ELSE
    SELECT l.eco_amount, l.eco_base, l.eco_rate
      INTO v_recorded_eco, v_recorded_base, v_recorded_rate
      FROM union_eco_ledger l
     WHERE l.union_id = p_union_id AND l.club_id = r.club_id
       AND l.period_start = v_from AND l.period_end = v_to;
    v_eco_recorded := FOUND;
    END IF;
    IF r.eco_enabled AND NOT v_eco_recorded THEN
      RAISE EXCEPTION 'union_squareup_eco_not_recorded' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to, 'stated_eco', r.eco_amount)::text;
    END IF;
    /* THE RECORD ANSWERS FOR ITS OWN ARITHMETIC (2026-09-25). The
       comparison below it - the document against union_eco_ledger - is
       the record against itself since 20260921040847 taught
       fn_union_club_invoice to RETURN the recorded amount, and a
       rehearsal proved it silent while a recorded value was mutated by
       0.01. The independent basis is IN the record: eco_base, eco_rate
       and eco_amount are stored side by side, all NOT NULL, and the
       producer defines the amount as round(-eco_rate*eco_base,2)
       (fn_union_pnl_evidence_report). Three stored numerics, no
       recomputation of the week, no second snapshot - so this can fire
       without resurrecting the 2026-09-14 overstatement that a second
       VOLATILE recomputation caused. The two arms below it are kept and
       are not weakened: the ECO-disabled arm is the one arm of the old
       comparison that could always fire. */
    IF r.eco_enabled AND v_eco_recorded AND v_components->>'eco_version' IS DISTINCT FROM '2'
       AND (v_recorded_base IS NULL OR v_recorded_rate IS NULL
            OR round(-v_recorded_rate * v_recorded_base, 2)
               IS DISTINCT FROM round(COALESCE(v_recorded_eco, 0), 2)) THEN
      RAISE EXCEPTION 'union_squareup_eco_record_fails_its_own_arithmetic' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'recorded_eco', v_recorded_eco, 'recorded_base', v_recorded_base,
          'recorded_rate', v_recorded_rate,
          'base_times_rate', round(-v_recorded_rate * v_recorded_base, 2))::text,
        HINT = 'union_eco_ledger.eco_amount must equal round(-eco_rate*eco_base,2). A record that does not support its own figure cannot be invoiced.';
    END IF;
    IF round(COALESCE(r.eco_amount, 0), 2)
       IS DISTINCT FROM round(COALESCE(v_recorded_eco, 0), 2) THEN
      RAISE EXCEPTION 'union_squareup_eco_disagrees_with_record' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'stated_eco', r.eco_amount, 'recorded_eco', v_recorded_eco)::text;
    END IF;
    IF NOT r.eco_enabled AND round(COALESCE(v_recorded_eco, 0), 2) <> 0 THEN
      RAISE EXCEPTION 'union_squareup_eco_disagrees_with_record' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'stated_eco', r.eco_amount, 'recorded_eco', v_recorded_eco,
          'eco_enabled', false)::text;
    END IF;

    SELECT sp.id INTO v_period_id
      FROM settlement_periods sp
     WHERE sp.club_id = r.club_id AND sp.union_id = p_union_id
       AND sp.start_at = v_from AND sp.end_at = v_to
     ORDER BY sp.created_at DESC LIMIT 1;

    IF v_period_id IS NULL THEN
      INSERT INTO settlement_periods (club_id, union_id, period_number, year,
                                      start_at, end_at, status)
      VALUES (r.club_id, p_union_id,
              EXTRACT(week FROM v_from)::int, EXTRACT(isoyear FROM v_from)::int,
              v_from, v_to, 'processing')
      RETURNING id INTO v_period_id;
    END IF;

    -- Reuse the number this document already carries. Take a new one ONLY
    -- when there is no document yet: the upsert below may take the ON
    -- CONFLICT path, and a number taken and not used is a gap in the series.
    SELECT si.invoice_number INTO v_number
      FROM settlement_invoices si
     WHERE si.club_id = r.club_id AND si.period_id = v_period_id
       AND si.invoice_type = 'union_weekly_squareup';
    IF NOT FOUND THEN
      v_number := public.fn_next_invoice_number(p_union_id, now());
    END IF;

    INSERT INTO settlement_invoices (
      club_id, period_id, invoice_type, invoice_number,
      from_entity_type, from_entity_id, to_entity_type, to_entity_id,
      gross_amount, net_amount, deductions, breakdown, status,
      chips_transferred, due_at, notes)
    VALUES (
      r.club_id, v_period_id, 'union_weekly_squareup', v_number,
      CASE WHEN r.outstanding >= 0 THEN 'union' ELSE 'club' END,
      CASE WHEN r.outstanding >= 0 THEN p_union_id::text ELSE r.club_id::text END,
      CASE WHEN r.outstanding >= 0 THEN 'club'  ELSE 'union' END,
      CASE WHEN r.outstanding >= 0 THEN r.club_id::text ELSE p_union_id::text END,
      abs(r.outstanding), abs(r.outstanding), 0,
      jsonb_build_object(
        'union_id', p_union_id, 'union_name', v_union_name,
        'club_id', r.club_id, 'club_name', r.club_name,
        'period_start', r.period_start, 'period_end', r.period_end,
        'rake_generated', r.rake_generated,
        'union_fee_kept', r.union_fee_kept,
        'rakeback_due',   r.rakeback_due,
        'players_won',    r.players_won,
        'player_pnl_net', r.player_pnl_net,
        'eco_amount',     r.eco_amount,
        'eco_enabled',    r.eco_enabled,
        'presettled',     r.presettled,
        'settled_in_chips', r.settled_in_chips,
        'outstanding',    r.outstanding,
        'net_position',   r.net_position,
        'direction',      r.direction,
        'baseline_cash_exact', v_basis_exact,
        'computed_at',    now())||v_components,
      'generated', false, v_due,
      'Weekly union square-up. settled_in_chips already moved during the week; '
      || 'outstanding is the amount to settle.'
      || CASE WHEN v_components ? 'weekly_player_results' THEN
       E'\nCash Player Net Loss: '||(v_components#>>'{weekly_player_results,cash_net_loss}')
       ||E'\nTournament Player Net Loss: '||(v_components#>>'{weekly_player_results,tournament_net_loss}')
       ||E'\nTotal Player Net Loss: '||(v_components#>>'{weekly_player_results,total_net_loss}')
       ||E'\nLess Club Rakeback Credit: '||(v_components#>>'{weekly_player_results,rakeback_credit}')
       ||E'\nECO Charge Or Credit: '||(v_components#>>'{weekly_player_results,eco_charge}')
       ||E'\nFull Weekly Net (Positive Club Owes Union): '||(v_components#>>'{weekly_player_results,weekly_net_due_to_union}')
       ||E'\nRemaining External Balance (Positive Union Owes Club): '||r.outstanding::text
       ||E'\nThe Full Weekly Net Is A Summary, Not An Additional Payment Request.'
       ELSE '' END)
    ON CONFLICT (club_id, period_id, invoice_type)
      WHERE invoice_type = 'union_weekly_squareup'
    DO UPDATE SET
      from_entity_type = EXCLUDED.from_entity_type,
      from_entity_id   = EXCLUDED.from_entity_id,
      to_entity_type   = EXCLUDED.to_entity_type,
      to_entity_id     = EXCLUDED.to_entity_id,
      gross_amount     = EXCLUDED.gross_amount,
      net_amount       = EXCLUDED.net_amount,
      invoice_number   = COALESCE(settlement_invoices.invoice_number, EXCLUDED.invoice_number),
      breakdown        = EXCLUDED.breakdown,
      due_at           = EXCLUDED.due_at,
      updated_at       = now()
    WHERE COALESCE(settlement_invoices.message_sent, false) = false AND settlement_invoices.status NOT IN('paid','cancelled')
    RETURNING id, COALESCE(message_sent, false) INTO v_invoice_id, v_already_sent;

    -- The upsert returns nothing when the guard above refused to restate an
    -- already-delivered invoice. That row is the record; read it as it stands.
    IF v_invoice_id IS NULL THEN
      SELECT si.id, COALESCE(si.message_sent, false)
        INTO v_invoice_id, v_already_sent
        FROM settlement_invoices si
       WHERE si.club_id = r.club_id
         AND si.period_id = v_period_id
         AND si.invoice_type = 'union_weekly_squareup';
    END IF;

    v_issued := v_issued + 1;

    -- Delivery is mandatory and shared with every accounting invoice.
    v_msg := public.fn_deliver_accounting_invoice(v_invoice_id);
    v_notified := v_notified + CASE WHEN v_already_sent THEN (v_msg->>'new_deliveries')::int ELSE (v_msg->>'delivered')::int END;
    v_messaged := v_messaged + CASE WHEN v_already_sent THEN (v_msg->>'new_deliveries')::int ELSE (v_msg->>'delivered')::int END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'club_id', r.club_id, 'club_name', r.club_name,
      'invoice_id', v_invoice_id, 'outstanding', r.outstanding,
      'direction', r.direction, 'due_at', v_due,
      'messaged', COALESCE((v_msg->>'delivered')::int, 0),
      'already_sent', v_already_sent));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'union_id', p_union_id,
    'period_start', v_from, 'period_end', v_to, 'due_at', v_due,
    'baseline_cash_exact', v_basis_exact,
    'invoices', v_issued, 'notified', v_notified, 'messenger_deliveries', v_messaged,
    'detail', v_out);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ca_union_statement_board(p_union_id uuid, p_period_end date DEFAULT NULL::date, p_history integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hist int := GREATEST(LEAST(COALESCE(p_history, 8), 52), 1);
  v_end  date;
  v_out  jsonb;
BEGIN
  IF NOT ca_can_oversee_union(p_union_id) THEN
    RAISE EXCEPTION 'not authorized for this union' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_period_end, MAX((s.breakdown->>'period_end')::date))
    INTO v_end
    FROM settlement_invoices s
   WHERE s.invoice_type = 'union_weekly_squareup'
     AND s.breakdown->>'union_id' = p_union_id::text;

  WITH invoice_eco AS NOT MATERIALIZED (
    -- Project the immutable issued invoice. Never rerun today's ECO terms or
    -- invent aggregate record IDs/rates for separately recorded activities.
    SELECT s.*, COALESCE(s.breakdown->'eco_version'='2'::jsonb
             AND e.parts=2 AND e.record_ids=2 AND e.cash_parts=1 AND e.tournament_parts=1 AND e.valid_parts
             AND jsonb_typeof(s.breakdown->'eco_amount')='number'
             AND CASE WHEN jsonb_typeof(s.breakdown->'eco_amount')='number'
                  THEN (s.breakdown->>'eco_amount')::numeric=e.component_amount END,false) AS recorded_eco_complete,
           e.cash_amount AS recorded_cash_eco_amount,
           e.tournament_amount AS recorded_tournament_eco_amount
      FROM settlement_invoices s
      CROSS JOIN LATERAL (
        SELECT count(*) AS parts, count(DISTINCT c.value->>'record_id') AS record_ids,
          count(*) FILTER(WHERE c.value->>'activity'='cash') AS cash_parts,
          count(*) FILTER(WHERE c.value->>'activity'='tournament') AS tournament_parts,
          bool_and(COALESCE(jsonb_typeof(c.value)='object'
            AND c.value->>'activity' IN('cash','tournament')
            AND jsonb_typeof(c.value->'enabled')='boolean'
            AND c.value->>'base_mode'='club_profit'
            AND jsonb_typeof(c.value->'base')='number'
            AND jsonb_typeof(c.value->'rate')='number'
            AND jsonb_typeof(c.value->'amount')='number'
            AND CASE WHEN jsonb_typeof(c.value->'amount')='number'
                 THEN (c.value->>'amount')::numeric=round((c.value->>'amount')::numeric,2) END
            AND CASE WHEN jsonb_typeof(c.value->'base')='number'
                 AND jsonb_typeof(c.value->'rate')='number' AND jsonb_typeof(c.value->'amount')='number'
                 AND jsonb_typeof(c.value->'enabled')='boolean'
                 THEN (c.value->>'rate')::numeric BETWEEN 0 AND 1
                  AND (c.value->>'amount')::numeric=CASE WHEN (c.value->>'enabled')::boolean
                   THEN round(-(c.value->>'base')::numeric*(c.value->>'rate')::numeric,2) ELSE 0 END END
            AND jsonb_typeof(c.value->'terms_id')='string'
            AND pg_input_is_valid(c.value->>'terms_id','uuid')
            AND jsonb_typeof(c.value->'record_id')='string'
            AND pg_input_is_valid(c.value->>'record_id','uuid')
            AND c.value->>'status'='recorded',false)) AS valid_parts,
          sum(CASE WHEN jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS component_amount,
          max(CASE WHEN c.value->>'activity'='cash' AND jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS cash_amount,
          max(CASE WHEN c.value->>'activity'='tournament' AND jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS tournament_amount
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.breakdown->'eco_components')='array'
          THEN s.breakdown->'eco_components' ELSE '[]'::jsonb END)c(value)
      )e
     WHERE s.invoice_type='union_weekly_squareup' AND s.breakdown->>'union_id'=p_union_id::text
  ),
  clubs_in_union AS (
    -- Current members must show missing invoices. Former members keep their
    -- historical invoice under the union that issued it, after membership moves.
    SELECT c.id AS club_id, c.name AS club_name, c.code AS club_code, c.slug AS club_slug
      FROM clubs c
     WHERE EXISTS (SELECT 1 FROM union_clubs uc WHERE uc.club_id=c.id AND uc.union_id=p_union_id)
        OR EXISTS (SELECT 1 FROM settlement_invoices s WHERE s.club_id=c.id
          AND s.invoice_type='union_weekly_squareup'
          AND s.breakdown->>'union_id'=p_union_id::text
          AND (v_end IS NULL OR (s.breakdown->>'period_end')::date=v_end))
  ),
  period_invoices AS (
    SELECT DISTINCT ON (s.club_id) s.*
      FROM invoice_eco s
      JOIN clubs_in_union cu ON cu.club_id = s.club_id
     WHERE s.invoice_type = 'union_weekly_squareup'
       AND s.breakdown->>'union_id' = p_union_id::text
       AND (v_end IS NULL OR (s.breakdown->>'period_end')::date = v_end)
     ORDER BY s.club_id, s.created_at DESC
  ),
  board AS (
    SELECT cu.club_id, cu.club_name, cu.club_code, cu.club_slug,
           (i.id IS NULL OR i.status <> 'paid' OR coalesce(i.net_amount,0)=0 OR i.breakdown->>'paid_total' IS NOT NULL) AS payment_details_available,
           i.id                            AS invoice_id,
           (i.net_amount IS NOT NULL
             AND i.breakdown->>'rake_generated' IS NOT NULL
             AND i.breakdown->>'rakeback_due' IS NOT NULL
             AND i.breakdown->>'union_fee_kept' IS NOT NULL) AS snapshot_complete,
           COALESCE(i.status, 'missing')   AS status,
           i.created_at                    AS issued_at,
           i.due_at,
           COALESCE(i.net_amount, 0)       AS amount,
           i.breakdown->>'direction'       AS direction,
           i.breakdown->'weekly_player_results' AS weekly_player_results,
           COALESCE(i.message_sent, false) AS message_sent,
           COALESCE((i.breakdown->>'paid_total')::numeric, 0)     AS paid_total,
           COALESCE((i.breakdown->>'rake_generated')::numeric, 0) AS rake_generated,
           COALESCE((i.breakdown->>'rakeback_due')::numeric, 0)   AS rakeback_due,
           COALESCE((i.breakdown->>'union_fee_kept')::numeric, 0) AS union_fee_kept,
           COALESCE((i.breakdown->>'players_won')::numeric, 0)    AS players_won,
           COALESCE((i.breakdown->>'eco_amount')::numeric, 0)     AS eco_amount,
           COALESCE((i.breakdown->>'presettled')::numeric, 0)     AS presettled,
           CASE WHEN i.id IS NOT NULL THEN COALESCE(i.breakdown->'eco_version','1'::jsonb) END AS eco_version,
           CASE WHEN i.breakdown->'eco_version'='2'::jsonb THEN i.breakdown->'eco_components' END AS eco_components,
           COALESCE(i.recorded_eco_complete,false) AS eco_components_complete,
           CASE WHEN i.recorded_eco_complete THEN i.recorded_cash_eco_amount END AS cash_eco_amount,
           CASE WHEN i.recorded_eco_complete THEN i.recorded_tournament_eco_amount END AS tournament_eco_amount
      FROM clubs_in_union cu
      LEFT JOIN period_invoices i ON i.club_id = cu.club_id
  ),
  history AS (
    SELECT (s.breakdown->>'period_end')::date AS period_end,
           MIN((s.breakdown->>'period_start')::date) AS period_start,
           count(*)                                  AS clubs,
           round(SUM(s.net_amount), 2)               AS total_amount,
           round(SUM(COALESCE((s.breakdown->>'rake_generated')::numeric, 0)), 2) AS rake_generated,
           round(SUM(COALESCE((s.breakdown->>'eco_amount')::numeric, 0)), 2)     AS eco_amount,
           bool_and(s.recorded_eco_complete) AS eco_components_complete,
           CASE WHEN bool_and(s.recorded_eco_complete) THEN round(SUM(s.recorded_cash_eco_amount),2) END AS cash_eco_amount,
           CASE WHEN bool_and(s.recorded_eco_complete) THEN round(SUM(s.recorded_tournament_eco_amount),2) END AS tournament_eco_amount,
           count(*) FILTER (WHERE s.status = 'paid')                             AS paid,
           count(*) FILTER (WHERE COALESCE(s.message_sent, false))               AS delivered
      FROM invoice_eco s
     WHERE s.invoice_type = 'union_weekly_squareup'
       AND s.breakdown->>'union_id' = p_union_id::text
       AND s.breakdown ? 'period_end'
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT v_hist
  )
  SELECT jsonb_build_object(
    'union_id', p_union_id,
    'union_name', (SELECT u.name FROM unions u WHERE u.id = p_union_id),
    'period_end', v_end,
    'period_start', (SELECT MIN((i.breakdown->>'period_start')::date) FROM period_invoices i),
    'totals', (SELECT jsonb_build_object(
                 'clubs',      count(*),
                 'issued',     count(*) FILTER (WHERE b.status <> 'missing'),
                 'missing',    count(*) FILTER (WHERE b.status = 'missing'),
                 'delivered',  count(*) FILTER (WHERE b.message_sent),
                 'paid',       count(*) FILTER (WHERE b.status = 'paid'),
                 'clubs_owe',  round(COALESCE(SUM(b.amount) FILTER (WHERE b.amount > 0), 0), 2),
                 'union_owes', round(COALESCE(SUM(-b.amount) FILTER (WHERE b.amount < 0), 0), 2),
                 'net',        round(COALESCE(SUM(b.amount), 0), 2),
                 'payment_details_available', coalesce(bool_and(b.payment_details_available),true), 'collected', CASE WHEN coalesce(bool_and(b.payment_details_available),true) THEN round(COALESCE(SUM(b.paid_total), 0), 2) END,
                 -- what is still out: the unpaid remainder, not the headline
                 'outstanding', CASE WHEN coalesce(bool_and(b.payment_details_available),true) THEN round(COALESCE(SUM(
                     GREATEST(abs(b.amount) - b.paid_total, 0))
                     FILTER (WHERE b.status NOT IN ('missing','cancelled')), 0), 2) END,
                 'rake_generated', round(COALESCE(SUM(b.rake_generated), 0), 2),
                 'eco_amount',     round(COALESCE(SUM(b.eco_amount), 0), 2),
                 'eco_components_complete',count(*)>0 AND bool_and(b.eco_components_complete),
                 'cash_eco_amount',CASE WHEN count(*)>0 AND bool_and(b.eco_components_complete) THEN round(SUM(b.cash_eco_amount),2) END,
                 'tournament_eco_amount',CASE WHEN count(*)>0 AND bool_and(b.eco_components_complete) THEN round(SUM(b.tournament_eco_amount),2) END)
                 FROM board b),
    'clubs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'club_id', b.club_id, 'club_name', b.club_name,
               'club_code', b.club_code, 'club_slug', b.club_slug,
               'invoice_id', b.invoice_id, 'status', b.status, 'snapshot_complete', b.snapshot_complete,
               'issued_at', b.issued_at, 'due_at', b.due_at,
               'amount', round(b.amount, 2), 'direction', b.direction,
               'message_sent', b.message_sent,
               'payment_details_available', b.payment_details_available, 'paid_total', CASE WHEN b.payment_details_available THEN round(b.paid_total, 2) END,
               'outstanding', CASE WHEN b.payment_details_available THEN round(GREATEST(abs(b.amount) - b.paid_total, 0), 2) END,
               -- overdue is derived, never stored: a stored flag needs a job to
               -- maintain it, and a job that does not run leaves the row lying
               'overdue', (b.status NOT IN ('paid','missing','cancelled')
                           AND b.due_at IS NOT NULL AND b.due_at < now()),
               'rake_generated', round(b.rake_generated, 2),
               'rakeback_due', round(b.rakeback_due, 2),
               'union_fee_kept', round(b.union_fee_kept, 2),
               'players_won', round(b.players_won, 2),
               'weekly_player_results',b.weekly_player_results,
               'eco_amount', round(b.eco_amount, 2),
               'eco_version',b.eco_version,'eco_components',b.eco_components,
               'eco_components_complete',b.eco_components_complete,
               'presettled', round(b.presettled, 2))
             ORDER BY (b.status = 'missing') DESC, b.amount DESC)
        FROM board b), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'period_start', h.period_start, 'period_end', h.period_end,
               'clubs', h.clubs, 'total_amount', h.total_amount,
               'rake_generated', h.rake_generated, 'eco_amount', h.eco_amount,
               'eco_components_complete',h.eco_components_complete,
               'cash_eco_amount',h.cash_eco_amount,'tournament_eco_amount',h.tournament_eco_amount,
               'paid', h.paid, 'delivered', h.delivered)
             ORDER BY h.period_end DESC)
        FROM history h), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_out;

  RETURN v_out;
END;
$function$
;

COMMIT;
