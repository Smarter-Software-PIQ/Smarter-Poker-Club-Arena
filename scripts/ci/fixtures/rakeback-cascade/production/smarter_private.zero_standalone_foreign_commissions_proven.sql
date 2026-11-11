CREATE OR REPLACE FUNCTION smarter_private.zero_standalone_foreign_commissions_proven(p_club uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE f uuid;comb jsonb;fr public.accounting_routed_settlement_runs%ROWTYPE;key text;
 had_windows boolean;had_clubs boolean;node_total numeric;bank_total numeric;down_total numeric;owner_total numeric;node_n int;owner_n int;paid_stamp timestamptz;stamp_n int;
BEGIN
 IF public.fn_caller_is_engine()IS DISTINCT FROM true OR public.fn_platform_frozen()IS DISTINCT FROM false
 OR to_regclass('pg_temp._routed_zero_standalone_context')IS NULL
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid=to_regclass('pg_temp._routed_zero_standalone_context')AND pg_get_userbyid(relowner)='postgres')
 THEN RAISE EXCEPTION 'zero_standalone_original_stage_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM pg_temp._routed_zero_standalone_context c WHERE c.scope_kind='club'AND c.scope_id=p_club AND c.period_start=p_start AND c.period_end=p_end AND c.source_count=0 AND c.fingerprint=md5(''))
 OR EXISTS(SELECT FROM pg_temp._routed_nodes)OR EXISTS(SELECT FROM pg_temp._routed_edges)
 THEN RAISE EXCEPTION 'zero_standalone_full_original_empty_plan_required' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT FROM public.agent_commission_settlements cs WHERE cs.club_id=p_club AND cs.period_start<p_end AND cs.period_end>p_start
  AND(cs.union_id IS NULL OR cs.period_start IS DISTINCT FROM p_start OR cs.period_end IS DISTINCT FROM p_end OR cs.paid_at IS NULL))
 THEN RAISE EXCEPTION 'zero_standalone_legacy_or_partial_foreign_settlement' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT FROM public.chip_ledger l WHERE l.idempotency_key='standalone-rake-bank:'||p_club::text||':'||to_char(p_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 OR EXISTS(SELECT FROM public.ca_mint_ledger m WHERE m.op_id='standalone-rake-bank:'||p_club::text||':'||to_char(p_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 THEN RAISE EXCEPTION 'zero_standalone_positive_or_unknown_bank_basis_refused' USING ERRCODE='23514';END IF;
 -- The original combine touches exactly four temporary relations and no GUC.
 -- Save every preexisting window/club row; own nodes/edges are genuinely empty.
 -- V3 does not use _routed_clubs and may inherit it from an earlier stage.
 had_clubs:=to_regclass('pg_temp._routed_clubs')IS NOT NULL;
 IF had_clubs THEN
  CREATE TEMP TABLE IF NOT EXISTS _zero_saved_r2_clubs(LIKE pg_temp._routed_clubs INCLUDING ALL)ON COMMIT DROP;
  TRUNCATE pg_temp._zero_saved_r2_clubs;INSERT INTO pg_temp._zero_saved_r2_clubs SELECT * FROM pg_temp._routed_clubs;
 END IF;
 had_windows:=to_regclass('pg_temp._close_r2_windows')IS NOT NULL;
 IF had_windows THEN
  CREATE TEMP TABLE IF NOT EXISTS _zero_saved_r2_windows(LIKE pg_temp._close_r2_windows INCLUDING ALL)ON COMMIT DROP;
  TRUNCATE pg_temp._zero_saved_r2_windows;
  INSERT INTO pg_temp._zero_saved_r2_windows SELECT * FROM pg_temp._close_r2_windows;
 END IF;
 CREATE TEMP TABLE IF NOT EXISTS _zero_foreign_owner_nodes(club_id uuid,user_id uuid,own_amount numeric,PRIMARY KEY(club_id,user_id))ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _zero_foreign_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,role text)ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _zero_foreign_endpoints(club_id uuid,actor_id uuid,PRIMARY KEY(club_id,actor_id))ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _zero_foreign_actual_r2_legs ON COMMIT DROP AS SELECT l.*FROM public.chip_ledger l WHERE false;
 FOR f IN SELECT DISTINCT cs.union_id FROM public.agent_commission_settlements cs
  WHERE cs.club_id=p_club AND cs.period_start<p_end AND cs.period_end>p_start ORDER BY cs.union_id
 LOOP
  SELECT * INTO fr FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind='union'AND r.scope_id=f AND r.union_id=f
   AND r.period_start=p_start AND r.period_end=p_end AND r.round_no=2 FOR SHARE;
  IF NOT FOUND OR fr.completed_at IS NULL OR fr.routing_version IS DISTINCT FROM 3
   OR fr.result->>'success'IS DISTINCT FROM 'true'OR fr.result->>'scope_kind'IS DISTINCT FROM 'union'OR fr.result->>'scope_id'IS DISTINCT FROM f::text
   OR fr.result->>'round'IS DISTINCT FROM '2'OR fr.result->>'routing_version'IS DISTINCT FROM '3'OR fr.result->>'source_version'IS DISTINCT FROM '2'
   OR fr.result->>'source_contract_version'IS DISTINCT FROM '3'OR fr.result->>'shortfalls'IS DISTINCT FROM '0'OR fr.result->>'paid_to'IS DISTINCT FROM 'agent_wallet'
  THEN RAISE EXCEPTION 'zero_standalone_canonical_foreign_round_required' USING ERRCODE='55000';END IF;
  comb:=public.fn_settle_accounting_commission_combine('union',f,p_start,p_end);
  IF comb IS NULL OR comb->>'read_failed'IS DISTINCT FROM 'false'OR comb->>'full_path'IS DISTINCT FROM 'false'
   OR comb->>'hierarchy_bad'IS DISTINCT FROM 'false'OR comb->>'entitlement_bad'IS DISTINCT FROM 'false'OR comb->>'unclassified'IS DISTINCT FROM '0'
   OR comb->>'fingerprint'IS DISTINCT FROM fr.source_fingerprint OR(comb->>'sources')::bigint IS DISTINCT FROM(fr.result->>'sources')::bigint
  THEN RAISE EXCEPTION 'zero_standalone_current_original_foreign_windows_required' USING ERRCODE='55000';END IF;
  key:='round2:v3:'||f::text||':'||extract(epoch FROM p_start)::text||':'||extract(epoch FROM p_end)::text;
  PERFORM cs.id FROM pg_temp._routed_nodes n JOIN public.agent_commission_settlements cs
   ON cs.club_id=n.club_id AND cs.user_id=n.user_id AND cs.period_start=p_start AND cs.period_end=p_end
   ORDER BY cs.club_id,cs.user_id,cs.id FOR SHARE OF cs;
  -- Independently derived per-node authority, not the run's aggregate alone.
  IF EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE(SELECT count(*)FROM public.agent_commission_settlements cs
    WHERE cs.club_id=n.club_id AND cs.user_id=n.user_id AND cs.union_id=f AND cs.period_start=p_start AND cs.period_end=p_end
     AND cs.amount=n.own_amount AND cs.rows_count=n.rows_count AND cs.settlement_ref=key AND cs.paid_at IS NOT NULL)<>1)
   OR EXISTS(SELECT FROM public.agent_commission_settlements cs WHERE cs.union_id=f AND cs.period_start<p_end AND cs.period_end>p_start
    AND(cs.period_start IS DISTINCT FROM p_start OR cs.period_end IS DISTINCT FROM p_end OR NOT EXISTS(SELECT FROM pg_temp._routed_nodes n
     WHERE n.club_id=cs.club_id AND n.user_id=cs.user_id AND n.own_amount=cs.amount AND n.rows_count=cs.rows_count AND cs.settlement_ref=key AND cs.paid_at IS NOT NULL)))
  THEN RAISE EXCEPTION 'zero_standalone_foreign_own_rows_not_bound' USING ERRCODE='23514';END IF;
  SELECT min(cs.paid_at),count(DISTINCT cs.paid_at)INTO paid_stamp,stamp_n FROM public.agent_commission_settlements cs
   WHERE cs.union_id=f AND cs.period_start=p_start AND cs.period_end=p_end AND cs.settlement_ref=key;
  IF stamp_n IS DISTINCT FROM 1 OR paid_stamp IS NULL OR fr.completed_at<paid_stamp
  THEN RAISE EXCEPTION 'zero_standalone_foreign_original_transaction_not_bound' USING ERRCODE='23514';END IF;
  -- The original writer inserts every edge with created_at DEFAULT now(),
  -- and every own settlement explicitly with paid_at=now(), in ONE transaction.
  -- Point-read every possible original source endpoint at that exact timestamp.
  -- No locale-dependent prefix range or whole-ledger metadata scan is used.
  -- This proves the canonical original writer's transaction, not global absence
  -- of unrelated later forged metadata or arbitrary foreign journal activity.
  TRUNCATE pg_temp._zero_foreign_endpoints,pg_temp._zero_foreign_actual_r2_legs;
  INSERT INTO pg_temp._zero_foreign_endpoints SELECT club_id,club_id FROM pg_temp._routed_clubs
   UNION SELECT club_id,user_id FROM pg_temp._routed_nodes;
  INSERT INTO pg_temp._zero_foreign_actual_r2_legs
   SELECT l.*FROM pg_temp._zero_foreign_endpoints ep CROSS JOIN LATERAL(
    SELECT z.*FROM public.chip_ledger z WHERE z.club_id=ep.club_id AND z.from_entity_id=ep.actor_id AND z.created_at=paid_stamp OFFSET 0)l
   WHERE l.idempotency_key LIKE key||':%'
    OR(l.category='commission'AND l.from_type IN('club_treasury','agent_wallet')
      AND(l.union_id=f OR l.metadata->>'accounting_scope_id'=f::text OR(l.union_id IS NULL AND NULLIF(l.metadata->>'accounting_scope_id','')IS NULL))
      AND CASE WHEN pg_input_is_valid(l.metadata->>'period_start','timestamptz')THEN(l.metadata->>'period_start')::timestamptz=p_start ELSE true END
      AND CASE WHEN pg_input_is_valid(l.metadata->>'period_end','timestamptz')THEN(l.metadata->>'period_end')::timestamptz=p_end ELSE true END)
    OR(l.category='treasury_transfer'AND l.metadata->>'payment_method'='owner_confirmed_existing_transfer'
      AND(l.union_id=f OR l.metadata->>'accounting_scope_id'=f::text OR(l.union_id IS NULL AND NULLIF(l.metadata->>'accounting_scope_id','')IS NULL))
      AND CASE WHEN pg_input_is_valid(l.metadata->>'period_start','timestamptz')THEN(l.metadata->>'period_start')::timestamptz=p_start ELSE true END
      AND CASE WHEN pg_input_is_valid(l.metadata->>'period_end','timestamptz')THEN(l.metadata->>'period_end')::timestamptz=p_end ELSE true END);

  TRUNCATE pg_temp._zero_foreign_owner_nodes,pg_temp._zero_foreign_edges;
  INSERT INTO pg_temp._zero_foreign_owner_nodes SELECT n.club_id,n.user_id,n.own_amount FROM pg_temp._routed_nodes n JOIN public.clubs c ON c.id=n.club_id AND c.owner_id=n.user_id;
  IF EXISTS(SELECT FROM pg_temp._routed_edges e JOIN pg_temp._zero_foreign_owner_nodes o ON o.club_id=e.club_id AND o.user_id=e.payee_user WHERE e.payer_user IS NOT NULL)
  THEN RAISE EXCEPTION 'zero_standalone_foreign_owner_hierarchy_changed' USING ERRCODE='23514';END IF;
  INSERT INTO pg_temp._zero_foreign_edges SELECT e.club_id,CASE WHEN o.user_id IS NULL THEN e.payer_user END,e.payee_user,sum(e.amount),min(e.role)
   FROM pg_temp._routed_edges e LEFT JOIN pg_temp._zero_foreign_owner_nodes o ON o.club_id=e.club_id AND o.user_id=e.payer_user
   WHERE NOT EXISTS(SELECT FROM pg_temp._zero_foreign_owner_nodes x WHERE x.club_id=e.club_id AND x.user_id=e.payee_user)
   GROUP BY e.club_id,CASE WHEN o.user_id IS NULL THEN e.payer_user END,e.payee_user;
  SELECT coalesce(sum(own_amount),0),count(*)INTO node_total,node_n FROM pg_temp._routed_nodes;
  SELECT coalesce(sum(own_amount),0),count(*)INTO owner_total,owner_n FROM pg_temp._zero_foreign_owner_nodes;
  SELECT coalesce(sum(amount)FILTER(WHERE payer_user IS NULL),0),coalesce(sum(amount)FILTER(WHERE payer_user IS NOT NULL),0)INTO bank_total,down_total FROM pg_temp._zero_foreign_edges;
  IF node_total IS DISTINCT FROM(fr.result->>'own_commission_amount')::numeric OR owner_total IS DISTINCT FROM(fr.result->>'owner_retained_in_club_bank')::numeric
   OR bank_total IS DISTINCT FROM(fr.result->>'amount')::numeric OR down_total IS DISTINCT FROM(fr.result->>'downstream_amount')::numeric
   OR node_n-owner_n IS DISTINCT FROM(fr.result->>'payees')::int OR bank_total+owner_total IS DISTINCT FROM node_total
   OR EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE(CASE WHEN EXISTS(SELECT FROM pg_temp._zero_foreign_owner_nodes o WHERE o.club_id=n.club_id AND o.user_id=n.user_id)THEN 0 ELSE n.own_amount END)
    IS DISTINCT FROM coalesce((SELECT sum(amount)FROM pg_temp._zero_foreign_edges e WHERE e.club_id=n.club_id AND e.payee_user=n.user_id),0)-coalesce((SELECT sum(amount)FROM pg_temp._zero_foreign_edges e WHERE e.club_id=n.club_id AND e.payer_user=n.user_id),0))
  THEN RAISE EXCEPTION 'zero_standalone_foreign_original_plan_not_conserved' USING ERRCODE='23514';END IF;
  -- A paid prior-transfer discharge is a separate real reimbursement; bind its
  -- source fingerprint and gross own amount to the same independently read node.
  IF EXISTS(SELECT FROM smarter_private.existing_rakeback_transfer_allocations a JOIN public.chip_ledger r ON r.id=a.reimbursement_ledger_id
   WHERE a.obligation_role='commission'AND a.period_start=p_start AND a.period_end=p_end
    AND r.metadata->>'accounting_scope_kind'='union'AND r.metadata->>'accounting_scope_id'=f::text
    AND(r.created_at IS DISTINCT FROM paid_stamp OR NOT smarter_private.existing_rakeback_transfer_complete('commission',a.obligation_id)
     OR NOT EXISTS(SELECT FROM pg_temp._routed_nodes n JOIN public.clubs c ON c.id=n.club_id WHERE n.club_id=a.club_id AND n.user_id=a.beneficiary_id
      AND a.amount=n.own_amount AND a.original_payer_id=c.owner_id
      AND a.source_fingerprint=md5(jsonb_build_array('commission_own',a.club_id,a.beneficiary_id,p_start,p_end,fr.source_fingerprint,n.own_amount)::text))
     OR NOT EXISTS(SELECT FROM pg_temp._zero_foreign_edges e WHERE e.club_id=a.club_id AND e.payee_user=a.beneficiary_id AND e.payer_user IS NULL AND e.amount>=a.amount)))
  THEN RAISE EXCEPTION 'zero_standalone_foreign_prior_discharge_not_bound' USING ERRCODE='23514';END IF;
  UPDATE pg_temp._zero_foreign_edges e SET amount=e.amount-coalesce((SELECT sum(a.amount)FROM smarter_private.existing_rakeback_transfer_allocations a JOIN public.chip_ledger r ON r.id=a.reimbursement_ledger_id
   WHERE a.obligation_role='commission'AND a.club_id=e.club_id AND a.beneficiary_id=e.payee_user AND a.period_start=p_start AND a.period_end=p_end
   AND r.metadata->>'accounting_scope_kind'='union'AND r.metadata->>'accounting_scope_id'=f::text),0)WHERE e.payer_user IS NULL;
  DELETE FROM pg_temp._zero_foreign_edges WHERE amount=0;
  IF EXISTS(SELECT FROM pg_temp._zero_foreign_edges e WHERE(SELECT count(*)FROM public.chip_ledger l
    WHERE l.idempotency_key=key||':'||e.club_id::text||':'||coalesce(e.payer_user::text,'club')||':'||e.payee_user::text
    AND l.status='posted'AND l.category='commission'AND l.created_at=paid_stamp AND l.union_id=f AND l.club_id=e.club_id
    AND l.from_type=CASE WHEN e.payer_user IS NULL THEN 'club_treasury'ELSE 'agent_wallet'END AND l.from_entity_id=coalesce(e.payer_user,e.club_id)
    AND l.to_type='agent_wallet'AND l.to_entity_id=e.payee_user AND l.amount=e.amount
    AND l.pre_from_balance-l.post_from_balance=e.amount AND l.post_to_balance-l.pre_to_balance=e.amount
    AND l.metadata->>'routing_version'='3'AND l.metadata->>'accounting_scope_kind'='union'AND l.metadata->>'accounting_scope_id'=f::text
    AND(l.metadata->>'period_start')::timestamptz=p_start AND(l.metadata->>'period_end')::timestamptz=p_end AND l.metadata->>'paid_to'='agent_wallet'
    AND l.metadata->>'payee_role_at_transfer'=e.role
    AND(l.metadata->>'own_commission')::numeric=(SELECT n.own_amount-coalesce((SELECT sum(a.amount)FROM smarter_private.existing_rakeback_transfer_allocations a JOIN public.chip_ledger r ON r.id=a.reimbursement_ledger_id WHERE a.obligation_role='commission'AND a.club_id=n.club_id AND a.beneficiary_id=n.user_id AND a.period_start=p_start AND a.period_end=p_end AND r.metadata->>'accounting_scope_kind'='union'AND r.metadata->>'accounting_scope_id'=f::text),0)FROM pg_temp._routed_nodes n WHERE n.club_id=e.club_id AND n.user_id=e.payee_user)
    AND(l.metadata->>'pass_through')::boolean=(e.payer_user IS NOT NULL)
    AND(SELECT count(*)FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid'AND i.chips_transferred AND i.message_sent AND i.gross_amount=l.amount AND i.net_amount=l.amount AND i.deductions=0)=1)<>1)
   OR EXISTS(SELECT FROM pg_temp._zero_foreign_actual_r2_legs l
    WHERE NOT EXISTS(SELECT FROM pg_temp._zero_foreign_edges e WHERE l.category='commission'AND l.idempotency_key=key||':'||e.club_id::text||':'||coalesce(e.payer_user::text,'club')||':'||e.payee_user::text)
     AND NOT EXISTS(SELECT FROM smarter_private.existing_rakeback_transfer_allocations a WHERE a.obligation_role='commission'AND a.reimbursement_ledger_id=l.id
      AND a.period_start=p_start AND a.period_end=p_end AND smarter_private.existing_rakeback_transfer_complete('commission',a.obligation_id))
     -- A legitimate R3 player reimbursement may share this same transaction.
     -- Classify it through its actual R3 certificate/admission, never role text alone.
     AND NOT EXISTS(SELECT FROM smarter_private.existing_rakeback_transfer_allocations a JOIN public.accounting_rakeback_period_calculations c ON c.id=a.certificate_id
      WHERE a.obligation_role='player'AND a.reimbursement_ledger_id=l.id AND a.period_start=p_start AND a.period_end=p_end AND c.coordinator_union_id=f
       AND l.union_id=f AND l.metadata->>'accounting_scope_kind'='union'AND l.metadata->>'accounting_scope_id'=f::text
       AND smarter_private.existing_rakeback_transfer_complete('player',a.obligation_id)))
  THEN RAISE EXCEPTION 'zero_standalone_foreign_actual_edge_receipt_not_bound' USING ERRCODE='23514';END IF;
 END LOOP;
 -- Restore every relation changed by the original combine, not a cached plan
 -- or a claimed zero. All original own-stage scalar facts remain untouched.
 TRUNCATE pg_temp._routed_nodes,pg_temp._routed_edges;
 IF had_clubs THEN TRUNCATE pg_temp._routed_clubs;INSERT INTO pg_temp._routed_clubs SELECT * FROM pg_temp._zero_saved_r2_clubs;
 ELSE DROP TABLE IF EXISTS pg_temp._routed_clubs;END IF;
 IF had_windows THEN TRUNCATE pg_temp._close_r2_windows;INSERT INTO pg_temp._close_r2_windows SELECT * FROM pg_temp._zero_saved_r2_windows;
 ELSE DROP TABLE IF EXISTS pg_temp._close_r2_windows;END IF;
END $function$
