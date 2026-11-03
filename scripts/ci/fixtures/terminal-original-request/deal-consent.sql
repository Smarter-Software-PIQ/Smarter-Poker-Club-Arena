-- Private funded two-player fixture: actual review, proposal and both participant votes.
BEGIN;
INSERT INTO public.ca_settle_sources(source,note) VALUES('final_table_deal','fn_final_table_deal') ON CONFLICT DO NOTHING;

SELECT * FROM public.claim_tournament_lease_v2('92010000-0000-0000-0000-000000000001','deal','native','92090000-0000-4000-8000-000000000002',30);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true),set_config('app.smarter_data_actor','tournament-manager',true),set_config('app.smarter_tournament_id','92010000-0000-0000-0000-000000000001',true),set_config('app.smarter_tournament_lease_generation','92090000-0000-4000-8000-000000000002',true),set_config('app.smarter_manager_request_fenced','protocol-2',true);
DO $consent$
DECLARE tid uuid:='92010000-0000-0000-0000-000000000001'; review jsonb; p jsonb; r jsonb; u uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',md5('zero-default-spin-launch-user:1')::uuid::text,true);
 review:=public.fn_request_tournament_deal_review(tid,auth.uid());
 IF review->>'state' IS DISTINCT FROM 'requested' THEN RAISE EXCEPTION 'review refused %',review; END IF;
 r:=public.fn_begin_tournament_deal_review(tid,(review->>'review_id')::uuid);
 IF r->>'review_state' IS DISTINCT FROM 'reviewing' THEN RAISE EXCEPTION 'begin refused %',r; END IF;
 p:=public.fn_get_tournament_deal_proposal(tid);
 IF p->>'ok' IS DISTINCT FROM 'true' OR p->>'pool_cents'<>'200' OR p->>'deal_cents'<>'200' THEN RAISE EXCEPTION 'proposal refused %',p; END IF;
 FOR u IN SELECT user_id FROM public.tournament_players WHERE tournament_id=tid LOOP
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  r:=public.fn_cast_tournament_deal_vote(tid,(p->>'proposal_id')::uuid,u);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'vote refused %',r; END IF;
 END LOOP;
 r:=public.fn_get_tournament_deal_consensus(tid);
 IF r->>'ready' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consensus refused %',r; END IF;
END $consent$;
COMMIT;
