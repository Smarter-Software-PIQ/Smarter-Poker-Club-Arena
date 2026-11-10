-- A DROPPED PREPARED NUMBER IS NOT THE NEXT DEALT HAND (2026-11-09).
--
-- #10138 sends the next cash hand's participant manifest under the rest. When
-- the roster changes after the request, the engine deals on a fresh number and
-- the prepared one keeps a manifest that no hand, receipt or outcome carries.
--
-- Scenario A of union-pnl-blocked-resolution is the production late-credit
-- race (blocked hand N, the occupancy's next dealt hand N+1). Here it is seeded
-- on its own table with the real next hand dealt at N+2, and N+1 is the dropped
-- number: a manifest for the same occupancy, a stack that does not carry the
-- late chips, and no provenance receipt. Run with PHASE=before (preimage) and
-- PHASE=after (postimage).
SELECT pg_temp.seed_race('adadadad-0000-0000-0000-000000000009',2000082,'2026-09-15 17:00:00+00',75.10,75.10,147.90,'addon',5,228.00,NULL);
DO $o$
DECLARE t uuid:='adadadad-0000-0000-0000-000000000009'; nxt public.cash_hand_participant_manifests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT nxt FROM public.cash_hand_participant_manifests WHERE table_id=t AND hand_number=2000083;
 -- The real next dealt hand moves to 2000084 and carries an accepted receipt.
 INSERT INTO public.cash_hand_participant_manifests VALUES(md5(t::text||'real')::uuid,t,2000084,nxt.captured_at+interval '3 seconds',
  nxt.lease_instance_id,nxt.lease_generation,nxt.request,nxt.game_scope,nxt.participants,nxt.issues,nxt.funding_provenance_complete);
 INSERT INTO public.cash_hand_provenance_receipts(table_id,hand_number,hand_id,accepted_at,payload_hash,manifest_id,status,game_scope,participants,
  all_players_included,funding_provenance_complete,issues,transaction_id)
 VALUES(t,2000084,md5(t::text||'hreal')::uuid,nxt.captured_at+interval '9 seconds','hreal',md5(t::text||'real')::uuid,'captured',
  nxt.game_scope,'[]',true,true,'[]','1'::xid8);
END $o$;
-- The fixture's seed manifest at 2000083 becomes the dropped number: same
-- occupancy, the stack the roster held before the change, and no receipt.
ALTER TABLE public.cash_hand_participant_manifests DISABLE TRIGGER USER;
UPDATE public.cash_hand_participant_manifests
   SET participants=jsonb_set(participants,'{0,stack_before}','80.10'::jsonb)
 WHERE table_id='adadadad-0000-0000-0000-000000000009' AND hand_number=2000083;
ALTER TABLE public.cash_hand_participant_manifests ENABLE TRIGGER USER;
