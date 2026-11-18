-- The Phase 6 fixture has the original physical and Lightning writers, from
-- before promo was introduced. Attach the actual clock at the same accepted
-- envelope branch. The companion classic test invokes the full promo owner.
DO $integrate$
DECLARE owner_sql text; anchor text:=E'  IF v_existing_request_hash IS NULL THEN\n';
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure)
 INTO owner_sql;
 IF length(owner_sql)-length(replace(owner_sql,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'original physical envelope acceptance changed';
 END IF;
 EXECUTE replace(owner_sql,anchor,anchor||E'    PERFORM public.fn_ca_promo_capture_cash_hand_clock(v_hand_id,p_table_id);\n');
END $integrate$;

-- Old hands may be recovered after their original transaction and seat
-- generations have gone. Even a missing original clock cannot be restamped.
DO $historical$
DECLARE h record;
BEGIN
 SELECT hand_id,table_id INTO STRICT h FROM public.hand_atomic_commits ORDER BY hand_number LIMIT 1;
 PERFORM public.fn_ca_promo_capture_cash_hand_clock(h.hand_id,h.table_id);
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks c WHERE c.hand_id=h.hand_id
    AND num_nonnulls(c.observation_order,c.writer_xid,c.visible_xids,c.observed_at,c.lightning_anchors)=0) THEN
  RAISE EXCEPTION 'historical replay gained a current observation';
 END IF;
END $historical$;

DO $original$
DECLARE g uuid; players uuid[]; formation jsonb; physical uuid; request_id uuid:=gen_random_uuid();
 spec jsonb; results jsonb; settled jsonb; again jsonb; captured public.ca_promo_cash_hand_clocks%ROWTYPE;
 expected jsonb; original_stacks text;
BEGIN
 g:=harness.cluster('cashout original host and feeder');
 UPDATE public.table_seats s SET occupancy_id=coalesce(s.occupancy_id,gen_random_uuid())
 FROM public.tables t WHERE t.id=s.table_id AND t.cluster_id=g;
 players:=(harness.at(g,true,false))[1:1]||(harness.at(g,false,true))[1:1];
 IF cardinality(players) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected two distinct original anchor sources';END IF;
 formation:=harness.form(g,players);
 physical:=(formation->>'hand_id')::uuid;
 PERFORM harness.deal((formation->>'instance_id')::uuid);
 spec:=jsonb_build_object(players[1]::text,jsonb_build_object('d',1,'c',2),
                         players[2]::text,jsonb_build_object('d',-1,'c',2));
 results:=harness.results(physical,spec);
 SELECT jsonb_agg(jsonb_build_object('player_id',hp.player_id,'hand_id',hp.hand_id,'seat_id',s.id,
   'table_id',s.table_id,'seat_joined_at',s.joined_at,'occupancy_id',s.occupancy_id) ORDER BY hp.player_id,s.id)
 INTO expected
 FROM public.lightning_hand_player hp JOIN public.lightning_pool_slot slot ON slot.id=hp.pool_slot_id
 JOIN public.lightning_pool_session ps ON ps.id=slot.pool_session_id AND ps.player_id=hp.player_id
 JOIN public.table_seats s ON s.id=ps.anchor_seat_id AND s.user_id=hp.player_id WHERE hp.hand_id=physical;
 IF jsonb_array_length(expected)<>2 OR expected->0->>'table_id'=expected->1->>'table_id' THEN
  RAISE EXCEPTION 'expected host and feeder seat generations';
 END IF;
 settled:=harness.settle(physical,request_id,results,0,0,'{}');
 IF settled->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'physical Lightning hand refused %',settled;END IF;
 SELECT * INTO STRICT captured FROM public.ca_promo_cash_hand_clocks WHERE hand_id=(settled->>'hand_history_id')::uuid;
 IF captured.lightning_anchors IS DISTINCT FROM expected OR captured.writer_xid IS DISTINCT FROM pg_current_xact_id()
  OR captured.visible_xids IS NULL OR captured.observation_order IS NULL OR captured.observed_at IS NULL
  OR NOT EXISTS(SELECT FROM public.cash_hand_provenance_receipts p WHERE p.hand_id=captured.hand_id
    AND p.transaction_id=captured.writer_xid AND p.accepted_request->>'ref'='lightning:'||physical::text)
  OR EXISTS(SELECT FROM public.lightning_settlement_marker WHERE hand_id=physical) THEN
  RAISE EXCEPTION 'original temporary Lightning anchors not retained in their genuine receipt';
 END IF;
 original_stacks:=harness.stacks(g);
 again:=harness.settle(physical,request_id,results,0,0,'{}');
 IF again->>'replay' IS DISTINCT FROM 'true' OR harness.stacks(g) IS DISTINCT FROM original_stacks
  OR NOT EXISTS(SELECT FROM public.ca_promo_cash_hand_clocks c WHERE c.hand_id=captured.hand_id
    AND c.observation_order=captured.observation_order AND c.lightning_anchors=expected)
  THEN RAISE EXCEPTION 'original Lightning replay changed the clock or money';END IF;
END $original$;
\echo 'PASS: original Lightning host and feeder generations survive physical settlement and replay'
