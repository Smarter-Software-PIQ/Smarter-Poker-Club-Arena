-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- LIGHTNING RESULTS BOOK TO THE CLUB THAT FUNDED THE SEAT (owner, 2026-11-01:
-- "Home club" for Lightning P&L).
--
-- Midway's Oct 19-26 books refuse to close: per club, buy-in/cash-out flows plus
-- seated cash must equal the hands' stack deltas, and about 495k chips of
-- Lightning hand results were booked to the Union itself (fade0000), while the
-- same players' flows and rake sit at their own clubs. Per club the gaps were
-- DSS -185,466.71, a0000000 -156,784.04, a41434bb -152,940.70 and the Union
-- +495,139.51 (sum -51.94). fn_lightning_original_pnl_proof took each
-- participant's earning club from the cash session, which a Lightning session
-- opens at the Union's Lightning table.
--
-- Now each participant is booked to the single club whose wallet funded the
-- seat's occupancy up to the hand (cash_participant_funding_receipts, the same
-- club the flows carry), when that club belongs to the game's union; otherwise
-- to the session club exactly as before. Every check that can refuse a hand is
-- unchanged and still reads the session club, so no hand accepted before is
-- refused now (this proof runs inside the live Lightning settlement
-- transaction). No rake, ledger, payout or rakeback change: rake sources are
-- already attributed to the players' clubs. Link resolutions already recorded
-- are not changed here (see the separate one-time supersession).
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_lightning_original_pnl_proof(uuid,bigint)'::regprocedure))
    IS DISTINCT FROM 'c8ca7384306de10f52c8bf806b9a1db3' THEN RAISE EXCEPTION 'lightning_pnl_proof_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_lightning_record_original_pnl(uuid,bigint,text)'::regprocedure))
    IS DISTINCT FROM '242ac2f838bfbaea08c96abd2e5cf9c4' THEN RAISE EXCEPTION 'lightning_pnl_recorder_changed'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_lightning_original_pnl_proof(p_table uuid, p_number bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE h public.lightning_hand; o public.union_pnl_cash_outcomes;
 p public.cash_hand_provenance_receipts; a public.hand_atomic_commits;
 started timestamptz; tr jsonb; scope jsonb; asset text; person record;
 n integer:=0; delta numeric:=0; before_stack numeric; after_stack numeric;
 v_earn uuid; v_fund uuid; v_fund_n integer; v_occ uuid;
 people jsonb:='[]'; receipts jsonb:='[]'; proof jsonb; signed_stacks jsonb;
BEGIN
 SELECT * INTO h FROM public.lightning_hand WHERE hand_number=p_number AND host_table_id=p_table;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_hand_missing'); END IF;
 SELECT * INTO o FROM public.union_pnl_cash_outcomes WHERE table_id=p_table AND hand_number=p_number;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','refused','reason','original_cash_outcome_missing'); END IF;
 SELECT * INTO p FROM public.cash_hand_provenance_receipts WHERE table_id=p_table AND hand_number=p_number;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','refused','reason','original_cash_provenance_missing'); END IF;
 SELECT * INTO a FROM public.hand_atomic_commits WHERE table_id=p_table AND hand_number=p_number;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','refused','reason','original_atomic_hand_missing'); END IF;
 SELECT started_at INTO started FROM public.hand_history WHERE id=h.hand_history_id AND table_id=p_table AND hand_number=p_number;
 IF started IS NULL OR NOT isfinite(started) OR NOT isfinite(h.formed_at) OR h.formed_at>started OR h.settled_at IS NULL OR NOT isfinite(h.settled_at)
  OR h.player_count<2 OR h.player_count>10
  OR (h.hand_history_id,p.hand_id,a.hand_id) IS DISTINCT FROM (o.hand_id,o.hand_id,o.hand_id)
  OR (p.payload_hash,a.payload_hash,h.settle_receipt->>'commit_hash') IS DISTINCT FROM (o.payload_hash,o.payload_hash,o.payload_hash)
  OR p.transaction_id IS DISTINCT FROM o.transaction_id
  OR p.status IS DISTINCT FROM 'uncertified' OR p.manifest_id IS NOT NULL
  OR p.issues IS DISTINCT FROM '["original_dealt_manifest_missing"]'::jsonb
  OR p.signed_external_net IS DISTINCT FROM 0::numeric
  OR h.settle_receipt->'ok' IS DISTINCT FROM 'true'::jsonb
  OR h.settle_receipt->>'hand_id' IS DISTINCT FROM h.hand_id::text
  OR h.settle_receipt->>'hand_history_id' IS DISTINCT FROM o.hand_id::text
  OR h.settle_receipt->>'host_table_id' IS DISTINCT FROM p_table::text
  OR h.settle_receipt->>'hand_number' IS DISTINCT FROM p_number::text
  OR h.settle_receipt->>'request_id' IS DISTINCT FROM h.settle_request_id::text
  OR h.settle_receipt->>'request_hash' IS DISTINCT FROM h.settle_request_hash
  OR h.settle_receipt->>'receipt_hash' IS DISTINCT FROM encode(sha256(convert_to((h.settle_receipt-'receipt_hash')::text,'UTF8')),'hex')
  OR h.settle_receipt->>'post_commit_payload_hash' IS DISTINCT FROM a.post_commit_payload_hash
  OR a.post_commit_payload IS NULL
  OR (a.post_commit_completed_at IS NOT NULL AND a.post_commit_result->'ok' IS DISTINCT FROM 'true'::jsonb)
  OR p.atomic_receipt->'stack_result' IS DISTINCT FROM a.stack_result
  OR p.atomic_receipt->>'payload_hash' IS DISTINCT FROM o.payload_hash
  OR a.stack_result->'success' IS DISTINCT FROM 'true'::jsonb
  OR a.stack_result->'conservation_checked' IS DISTINCT FROM 'true'::jsonb
  OR a.stack_result->>'mode' IS DISTINCT FROM 'delta'
  OR a.stack_result->'request'->'stacks' IS DISTINCT FROM p.accepted_request->'stacks'
  OR NOT public.fn_cash_signed_retained_request_matches(p_table,p_number,o.payload_hash,p.accepted_request)
 THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_identity_or_signature_disagrees'); END IF;
 -- Scope is the retained original table observation, never today's table.
 SELECT e.after_row INTO tr FROM public.union_pnl_inventory_events e
  WHERE e.source_name='tables' AND e.row_id=p_table AND e.observed_at<=started
  ORDER BY e.event_id DESC LIMIT 1;
 SELECT c.asset INTO asset FROM public.clubs c WHERE c.id=(tr->>'club_id')::uuid;
 scope:=jsonb_build_object('host_club_id',tr->'club_id','game_union_id',
  CASE WHEN tr->'is_private'='true'::jsonb THEN 'null'::jsonb ELSE tr->'union_id' END,
  'is_private',tr->'is_private','tournament_id',tr->'tournament_id','asset',asset,'unit_scale',2);
 IF tr IS NULL OR asset IS DISTINCT FROM 'chips' OR tr->'tournament_id' IS DISTINCT FROM 'null'::jsonb
  OR jsonb_typeof(tr->'is_private') IS DISTINCT FROM 'boolean'
  OR (tr->'is_private'='false'::jsonb AND tr->>'union_id' IS NULL)
 THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_game_scope_unproven'); END IF;
 signed_stacks:=a.stack_result#>'{request,stacks}';
 IF jsonb_typeof(signed_stacks) IS DISTINCT FROM 'array'
  OR jsonb_array_length(signed_stacks)<>h.player_count
  OR (SELECT count(*) FROM jsonb_object_keys(h.settle_receipt->'deltas'))<>h.player_count
 THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_roster_incomplete'); END IF;
 FOR person IN
  SELECT hp.*,sl.pool_session_id,sl.opened_at slot_opened,sl.closed_at slot_closed,
   ps.cash_player_session_id,ps.entered_at,ps.exited_at,ps.anchor_seat_id,
   cs.club_id,cs.table_id cash_table_id,cs.opened_at cash_opened,cs.closed_at cash_closed,
   (SELECT count(*) FROM jsonb_array_elements(signed_stacks) s WHERE s->>'user_id'=hp.player_id::text) signed_count,
   (SELECT s FROM jsonb_array_elements(signed_stacks) s WHERE s->>'user_id'=hp.player_id::text LIMIT 1) signed_stack
  FROM public.lightning_hand_player hp
  LEFT JOIN public.lightning_pool_slot sl ON sl.id=hp.pool_slot_id AND sl.player_id=hp.player_id
   AND sl.cluster_id=h.cluster_id AND sl.cluster_epoch=h.cluster_epoch
  LEFT JOIN public.lightning_pool_session ps ON ps.id=sl.pool_session_id AND ps.player_id=hp.player_id
   AND ps.cluster_id=h.cluster_id AND ps.cluster_epoch=h.cluster_epoch
  LEFT JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id AND cs.player_id=hp.player_id
  WHERE hp.hand_id=h.hand_id ORDER BY hp.seat
 LOOP
  before_stack:=public.fn_pnl_evidence_cents(person.signed_stack->'stack_before');
  after_stack:=public.fn_pnl_evidence_cents(person.signed_stack->'stack');
  IF (person.cluster_id=h.cluster_id AND person.cluster_epoch=h.cluster_epoch
   AND person.club_id IS NOT NULL AND person.signed_count=1
   AND isfinite(person.cash_opened) AND person.cash_opened<=started AND (person.cash_closed IS NULL OR (isfinite(person.cash_closed) AND person.cash_closed>started))
   AND isfinite(person.entered_at) AND person.entered_at<=started AND (person.exited_at IS NULL OR (isfinite(person.exited_at) AND person.exited_at>started))
   AND isfinite(person.slot_opened) AND person.slot_opened<=started AND (person.slot_closed IS NULL OR (isfinite(person.slot_closed) AND person.slot_closed>started))
   AND before_stack>=0 AND after_stack>=0 AND before_stack=person.stack_before AND after_stack=person.stack_after
   AND person.net_result=after_stack-before_stack
   AND person.signed_stack->>'seat_id'=person.anchor_seat_id::text
   AND (h.settle_receipt->'deltas'->>person.player_id::text)::numeric=person.net_result
   AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=person.club_id
    AND (c.is_union IS NOT TRUE OR c.id=(scope->>'game_union_id')::uuid OR c.union_id=(scope->>'game_union_id')::uuid))) IS NOT TRUE
  THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_pool_custody_disagrees','user_id',person.player_id); END IF;
  -- THE PLAYER'S OWN CLUB (20261101). A Lightning session is opened at the
  -- Union's Lightning table, so its cash session names the Union; the chips at
  -- the seat came from the player's own club wallet, which is the club the
  -- week's buy-in/cash-out flows and rake sources already carry. The result is
  -- booked to the single club that funded this seat's occupancy up to the
  -- hand, when that club belongs to the game's union; otherwise to the session
  -- club exactly as before, so no hand accepted before is refused now.
  v_earn:=person.club_id; v_occ:=NULL; v_fund:=NULL; v_fund_n:=NULL;
  SELECT r.occupancy_id INTO v_occ FROM public.cash_participant_funding_receipts r
   WHERE r.table_id=person.cash_table_id AND r.account_entity_id=person.player_id AND r.operation_kind='buyin'
     AND r.user_id=person.player_id AND r.seat_id=person.anchor_seat_id AND r.recorded_at<=started
   ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
  IF v_occ IS NOT NULL THEN
   SELECT count(DISTINCT r.funding_club_id),min(r.funding_club_id::text)::uuid INTO v_fund_n,v_fund
    FROM public.cash_participant_funding_receipts r
    WHERE r.occupancy_id=v_occ AND r.recorded_at<=started AND r.funding_club_id IS NOT NULL;
  END IF;
  IF v_fund_n=1 AND v_fund IS DISTINCT FROM person.club_id AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_fund
     AND c.is_union IS NOT TRUE AND (c.union_id=(scope->>'game_union_id')::uuid
      OR EXISTS(SELECT 1 FROM public.union_clubs uc WHERE uc.club_id=v_fund AND uc.union_id=(scope->>'game_union_id')::uuid))) THEN
   v_earn:=v_fund;
  END IF;
  n:=n+1; delta:=delta+person.net_result;
  people:=people||jsonb_build_array(jsonb_build_object('user_id',person.player_id,
   'observed_stack_delta',person.net_result,'earning_club_id',v_earn,
   'ownership_certified',true,'ownership_scope','original_lightning_pool_session',
   'funding_receipt_ids','[]'::jsonb,'original_funding_session_ids',jsonb_build_array(person.cash_player_session_id),
   'pool_slot_id',person.pool_slot_id,'pool_session_id',person.pool_session_id));
 END LOOP;
 IF n<>h.player_count OR p.rake IS NULL OR p.bbj IS NULL OR p.rake<0 OR p.bbj<0
  OR p.rake IS DISTINCT FROM public.fn_pnl_evidence_cents(h.settle_receipt->'rake')
  OR p.bbj IS DISTINCT FROM public.fn_pnl_evidence_cents(h.settle_receipt->'bbj')
  OR p.rake IS DISTINCT FROM public.fn_pnl_evidence_cents(a.stack_result#>'{request,rake}')
  OR p.bbj IS DISTINCT FROM public.fn_pnl_evidence_cents(a.stack_result#>'{request,bbj}')
  OR delta+p.rake+p.bbj<>0
 THEN RETURN jsonb_build_object('status','refused','reason','original_lightning_conservation_disagrees'); END IF;
 proof:=jsonb_build_object('status','ready','basis_certified',true,'scope','single_accepted_cash_hand',
  'payment_authorized',false,'hand_id',o.hand_id,'table_id',p_table,'hand_number',p_number,
  'observed_commit_at',o.recognized_at,'observed_delta_total',delta,'participants',people,'issues','[]'::jsonb,
  'game_scope',scope,'current_seats_used',false,'current_membership_used',false,'all_players_included',true,
  'accepted_rake',p.rake,'accepted_bbj',p.bbj,'accepted_external_net',0,'provenance_link','resolved');
 RETURN jsonb_build_object('status','proven','resolution_kind','cash_outcome_provenance_link',
  'original_custody_kind','lightning_pool_session','table_id',p_table,'hand_number',p_number,'hand_id',o.hand_id,
  'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
  'roster_source','lightning_pool','manifest_id',NULL,'game_scope',scope,'evidence',proof,
  'lightning_hand_id',h.hand_id,'settle_receipt_hash',h.settle_receipt->>'receipt_hash');
END $function$;
REVOKE ALL ON FUNCTION public.fn_lightning_original_pnl_proof(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

DO $post$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='public.fn_lightning_original_pnl_proof(uuid,bigint)'::regprocedure;
 IF NOT p.prosecdef OR p.provolatile<>'s' OR p.proowner<>'postgres'::regrole
  OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') THEN
  RAISE EXCEPTION 'lightning_pnl_proof_postimage_authority_changed';
 END IF;
 IF md5(pg_get_functiondef('public.fn_lightning_record_original_pnl(uuid,bigint,text)'::regprocedure))
    IS DISTINCT FROM '242ac2f838bfbaea08c96abd2e5cf9c4' THEN RAISE EXCEPTION 'lightning_pnl_recorder_changed_by_install'; END IF;
END
$post$;
COMMIT;
