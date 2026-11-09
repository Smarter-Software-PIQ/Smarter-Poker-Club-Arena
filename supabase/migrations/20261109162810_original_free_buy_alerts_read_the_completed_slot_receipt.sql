-- Original Midway missing-slot pages survive their replacements' completion.
-- The digest knows financial and Alertmanager receipts but had no slot proof.
-- Its per-type client annotation also counted only investigation labels.
-- Read each original through one proof owner, retaining reviewed versus
-- verified, and return the same original-ID proof to the per-type consumer.
-- Original IDs 352939/352940 have exact completed replacements and receipts.
-- Cancelled predecessors, a different slot/union and open escrow stay unknown.
-- No alert, tournament or financial row is changed.
-- @live-proof: position('canonical_alert_proof' in pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION public.fn_sp_original_alert_proof(p_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp AS $function$
DECLARE original public.operational_alert_events%ROWTYPE;
        witness text; kind text; reference text; verified boolean:=false;
BEGIN
  SELECT * INTO original FROM public.operational_alert_events WHERE id=p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reviewed',false,'verified',false,'kind',NULL,'reference',NULL);
  END IF;
  IF original.source IN ('financial-alerts-backfill','financial-alerts-updates') THEN
    SELECT financial.id::text INTO witness FROM public.financial_alerts financial
    WHERE financial.id=CASE WHEN pg_input_is_valid(original.payload#>>'{original_event,id}','uuid')
      THEN (original.payload#>>'{original_event,id}')::uuid END
      AND financial.source=original.alertname
      AND CASE WHEN pg_input_is_valid(original.payload#>>'{original_event,created_at}','timestamp with time zone')
        THEN financial.created_at=(original.payload#>>'{original_event,created_at}')::timestamptz ELSE false END
      AND financial.resolved IS TRUE AND financial.resolved_at>=financial.created_at;
    IF FOUND THEN kind:='financial_alert'; reference:='Resolved financial alert '||witness; END IF;
  ELSIF original.source='alertmanager' THEN
    SELECT closed.id::text INTO witness FROM public.operational_alert_events closed
    WHERE closed.source='alertmanager' AND closed.status='resolved'
      AND closed.alertname=original.alertname
      AND nullif(original.payload#>>'{alert,fingerprint}','') IS NOT NULL
      AND closed.payload#>>'{alert,fingerprint}'=original.payload#>>'{alert,fingerprint}'
      AND nullif(original.payload#>>'{alert,startsAt}','') IS NOT NULL
      AND closed.payload#>>'{alert,startsAt}'=original.payload#>>'{alert,startsAt}'
      AND jsonb_typeof(original.payload#>'{alert,labels}')='object'
      AND original.payload#>>'{alert,labels,alertname}'=original.alertname
      AND closed.payload#>'{alert,labels}'=original.payload#>'{alert,labels}'
      AND closed.payload#>>'{alert,status}'='resolved'
      AND COALESCE(closed.last_received_at,closed.received_at)>=COALESCE(original.last_received_at,original.received_at)
      AND CASE WHEN pg_input_is_valid(original.payload#>>'{alert,startsAt}','timestamp with time zone')
        AND pg_input_is_valid(closed.payload#>>'{alert,endsAt}','timestamp with time zone')
        THEN (closed.payload#>>'{alert,endsAt}')::timestamptz >= (original.payload#>>'{alert,startsAt}')::timestamptz
        ELSE false END
    ORDER BY closed.id DESC LIMIT 1;
    IF FOUND THEN kind:='alertmanager_resolved'; reference:='Matching resolved Alertmanager event '||witness; END IF;
  ELSIF original.source='sp-critical-pager'
    AND original.alertname='CriticalPage.midway_free_buy_missing' THEN
    SELECT t.id::text INTO witness
    FROM public.tournaments t
    JOIN public.tournament_terminal_settlements s ON s.tournament_id=t.id
    JOIN public.tournament_escrow e ON e.tournament_id=t.id
    WHERE jsonb_typeof(original.payload#>'{detail,name}')='string'
      AND jsonb_typeof(original.payload#>'{detail,starts}')='string'
      AND jsonb_typeof(original.payload#>'{detail,expected_format}')='string'
      AND original.payload#>>'{detail,expected_format}' IN ('regular','pko','aiof','mystery')
      AND t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
      AND t.name=original.payload#>>'{detail,name}'
      AND t.start_time=CASE WHEN pg_input_is_valid(original.payload#>>'{detail,starts}','timestamp with time zone')
        THEN (original.payload#>>'{detail,starts}')::timestamptz END
      AND public.fn_ca_midway_free_buy_format(t.id)=original.payload#>>'{detail,expected_format}'
      AND public.fn_ca_midway_free_buy_slot_format(t.id)=original.payload#>>'{detail,expected_format}'
      AND t.status='COMPLETED' AND t.current_players=0
      AND s.settled_at>=original.received_at AND s.completed_at=t.ended_at
      AND s.escrow_closed_at=e.terminal_closed_at AND e.terminal_closed_at>=original.received_at
      AND s.prize_pool=t.prize_pool AND s.cash_payout_total=s.prize_pool
      AND s.bounty_pool=t.bounty_pool AND s.bounty_payout_total=s.bounty_pool
      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0
    ORDER BY t.created_at,t.id LIMIT 1;
    IF FOUND THEN kind:='midway_slot_receipt'; reference:='Completed original Midway slot with terminal receipt '||witness; END IF;
  END IF;
  verified:=kind IS NOT NULL;
  IF NOT verified AND original.investigation_status='verified_fixed' THEN
    verified:=true; kind:='verified_fixed';
    reference:=COALESCE(NULLIF(original.investigation->>'fixing_pr',''),'Verified original alert '||original.id::text);
  END IF;
  RETURN jsonb_build_object('reviewed',verified OR COALESCE(original.investigation_status='historical',false),
    'verified',verified,'kind',kind,'reference',reference);
END $function$;
REVOKE ALL ON FUNCTION public.fn_sp_original_alert_proof(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_original_alert_proof(bigint) TO service_role;

DO $patch$
DECLARE source text:=pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure);
        old_predicate text; start_at integer; end_at integer; anchor text;
BEGIN
  IF md5(source)<>'edc6f33249c8b91828578705c7908f1e' THEN RAISE EXCEPTION 'ORIGINAL_SLOT_DIGEST_PREIMAGE_CHANGED'; END IF;
  start_at:=strpos(source,'count(*) FILTER(WHERE original.investigation_status IN (''verified_fixed'',''historical'')');
  end_at:=strpos(substr(source,start_at),') reviewed,')+start_at+length(') reviewed,')-1;
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'ORIGINAL_SLOT_DIGEST_PREDICATE_CHANGED'; END IF;
  old_predicate:=substr(source,start_at,end_at-start_at);
  source:=replace(source,old_predicate,'count(*) FILTER(WHERE (m.proof->>''reviewed'')::boolean) reviewed,');
  anchor:=$old$        )
        SELECT count(*) members,
               count(*) FILTER(WHERE (m.proof->>'reviewed')::boolean) reviewed,$old$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'ORIGINAL_SLOT_DIGEST_MEMBERS_CHANGED'; END IF;
  source:=replace(source,anchor,$new$        ), outcomes AS MATERIALIZED (
          SELECT m.*,public.fn_sp_original_alert_proof(m.id) proof FROM members m
        )
        SELECT (SELECT jsonb_agg(to_jsonb(g) ORDER BY g.alertname) FROM (
          SELECT m.alertname,array_agg(m.id ORDER BY m.id) event_ids,count(*) total,
            count(*) FILTER(WHERE (m.proof->>'reviewed')::boolean) reviewed,
            count(*) FILTER(WHERE (m.proof->>'verified')::boolean) verified,
            jsonb_agg(jsonb_build_object('event_id',m.id,'reviewed',m.proof->'reviewed',
              'verified',m.proof->'verified','kind',m.proof->'kind','reference',m.proof->'reference') ORDER BY m.id) proofs,
            COALESCE(jsonb_agg(DISTINCT m.proof->'reference') FILTER(WHERE (m.proof->>'verified')::boolean),'[]'::jsonb) fixes
          FROM outcomes m GROUP BY m.alertname) g) proof_groups,
               count(*) members,
               count(*) FILTER(WHERE (m.proof->>'reviewed')::boolean) reviewed,$new$);
  anchor:='FROM members m LEFT JOIN public.operational_alert_events original ON original.id=m.id';
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'ORIGINAL_SLOT_DIGEST_OUTCOMES_CHANGED'; END IF;
  source:=replace(source,anchor,'FROM outcomes m LEFT JOIN public.operational_alert_events original ON original.id=m.id');
  anchor:=$old$                       ELSE o.investigation->>'resolution' END) x$old$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'ORIGINAL_SLOT_DIGEST_ENVELOPE_CHANGED'; END IF;
  source:=replace(source,anchor,$new$                       ELSE o.investigation->>'resolution' END)
        || CASE WHEN it->>'rule'='critical_alert_rising' THEN jsonb_build_object(
          'canonical_alert_proof',jsonb_build_object('version',1,
            'linkage_complete',grouped.linkage_complete,'groups',COALESCE(grouped.proof_groups,'[]'::jsonb)))
          ELSE '{}'::jsonb END x$new$);
  EXECUTE source;
END $patch$;
COMMIT;
