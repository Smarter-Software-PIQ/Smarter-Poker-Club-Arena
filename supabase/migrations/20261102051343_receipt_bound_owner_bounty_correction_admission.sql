-- Owner-authorized exact-event correction of a combined bounty guarantee.
-- Preserve paid awards and immutable receipts; admit only the row images bound
-- to the one 950-chip reversal. All other trigger behavior remains unchanged.
-- Does not change trigger enabled states or execute the financial operation.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $patch$
DECLARE d text; entry record;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
 ('public.fn_guard_managed_game_lifecycle()','a656a90ce0a52a9c28b331a951387a12'),
 ('public.trg_freeze_finalized_tournament_prize_pool()','08b2e89dc6ad0026e5bc04260265ac48')
 ) AS x(signature, expected) LOOP
   SELECT pg_get_functiondef(p.oid) INTO STRICT d FROM pg_proc p
    WHERE p.oid=entry.signature::regprocedure AND md5(p.prosrc)=entry.expected;
   IF strpos(d,E'BEGIN\n')=0 THEN RAISE EXCEPTION 'guard entry missing'; END IF;
   d:=overlay(d placing E'BEGIN\n' || $admission$
  -- One owner-authorized correction: the journal binds both complete row images.
  -- No GUC alone, caller impersonation, trigger disabling or other event is admitted.
  IF TG_TABLE_NAME='tournaments' THEN
  IF current_user='postgres'
     AND OLD.id='6b72abc3-bd16-488c-aea5-54b1eace98d5'::uuid
     AND OLD.status='RUNNING' AND NEW.status='RUNNING'
     AND OLD.prize_pool=5000 AND NEW.prize_pool=4050
     AND OLD.guaranteed_prize=5000 AND NEW.guaranteed_prize=5000
     AND OLD.bounty_pool=950 AND NEW.bounty_pool=950
     AND OLD.prize_pool_finalized AND NEW.prize_pool_finalized
     AND (to_jsonb(NEW)-ARRAY['prize_pool','payout_structure'])
       =(to_jsonb(OLD)-ARRAY['prize_pool','payout_structure'])
     AND current_setting('app.owner_bounty_guarantee_correction',true)=
       'tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102'
     AND EXISTS (
       SELECT 1 FROM public.chip_ledger l
       WHERE l.idempotency_key=current_setting('app.owner_bounty_guarantee_correction',true)
         AND l.tournament_id=OLD.id AND l.category='reversal' AND l.amount=950
         AND l.from_type='prize_liability' AND l.from_entity_id=OLD.id
         AND l.to_type='union_bank'
         AND l.to_entity_id='fade0000-0000-0000-0000-000000000001'::uuid
         AND l.metadata->>'kind'='owner_bounty_guarantee_correction'
         AND l.metadata->'tournament_before'=to_jsonb(OLD)
         AND l.metadata->'tournament_after'=to_jsonb(NEW)
         AND l.metadata->>'overlay_after'='1580'
         AND l.metadata->>'owner_instruction'=
           'go through and manually change the payout to the corrected 5000 prize pool and pay the overlay'
     ) THEN
    RETURN NEW;
  END IF;
  END IF;
$admission$ from strpos(d,E'BEGIN\n') for 6);
   EXECUTE d;
 END LOOP;
END;
$patch$;
COMMIT;
