-- A stale PKO build must never replace an Afternoon slot's 500-chip guarantee.
-- The ordinary format triggers run first, just as they do for a scheduler write.
BEGIN;
DO $case$
DECLARE
  slot uuid := '50000000-0000-0000-0000-000000000001';
  event uuid := '10000000-0000-0000-0000-000000000109';
  historical uuid := '10000000-0000-0000-0000-000000000110';
  candidate tournaments%ROWTYPE;
  before_row jsonb;
BEGIN
  INSERT INTO tournament_schedules(id, name, config)
  VALUES (slot, 'Afternoon Free Buy (NLH)', '{"midwayFreeBuyFormat":"midway-free-buy-aiof-v1", "guaranteedPrize":500}');

  -- Reuse the synthetic PKO row whose registration terms the rotation froze.
  SELECT * INTO STRICT candidate FROM tournaments WHERE id='10000000-0000-0000-0000-000000000105';
  candidate.id := event;
  candidate.name := 'Afternoon Free Buy (NLH)';
  candidate.schedule_id := slot;
  BEGIN
    INSERT INTO tournaments SELECT candidate.*;
    RAISE EXCEPTION 'wrong-format INSERT admitted a zero-guarantee PKO';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'MIDWAY_FREE_BUY_SHAPE_DIFFERS_FROM_ITS_SCHEDULE:%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT FROM tournaments WHERE id=event) THEN RAISE EXCEPTION 'refused row persisted'; END IF;

  SELECT * INTO STRICT candidate FROM tournaments WHERE id='10000000-0000-0000-0000-000000000102';
  candidate.id := event;
  candidate.schedule_id := slot;
  candidate.guaranteed_prize := 0; -- the live BEFORE INSERT must normalize this to 500
  INSERT INTO tournaments SELECT candidate.*;
  SELECT to_jsonb(t) INTO STRICT before_row FROM tournaments t WHERE id=event;
  IF fn_ca_midway_free_buy_slot_format(event) IS DISTINCT FROM 'aiof'
    OR fn_ca_midway_free_buy_format(event) IS DISTINCT FROM 'aiof'
    OR (before_row->>'guaranteed_prize')::numeric IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'correctly built Afternoon event did not retain its 500-chip guarantee';
  END IF;
  BEGIN
    UPDATE tournaments SET is_pko=true, is_bounty=true, all_in_or_fold=false, guaranteed_prize=0 WHERE id=event;
    RAISE EXCEPTION 'wrong-format UPDATE removed the promised guarantee';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'MIDWAY_FREE_BUY_SHAPE_DIFFERS_FROM_ITS_SCHEDULE:%' THEN RAISE; END IF;
  END;
  IF (SELECT to_jsonb(t) FROM tournaments t WHERE id=event) IS DISTINCT FROM before_row THEN
    RAISE EXCEPTION 'failed reshape changed the stored event';
  END IF;

  BEGIN
    UPDATE tournaments SET guaranteed_prize=0 WHERE id=event;
    RAISE EXCEPTION 'guarantee-only UPDATE removed the promised 500 from a correctly flagged AIOF';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'MIDWAY_FREE_BUY_GUARANTEE_DIFFERS_FROM_ITS_SCHEDULE:%' THEN RAISE; END IF;
  END;
  IF (SELECT to_jsonb(t) FROM tournaments t WHERE id=event) IS DISTINCT FROM before_row THEN
    RAISE EXCEPTION 'failed guarantee-only edit changed the stored event';
  END IF;

  -- A historical event already started under PKO terms. Linking its original
  -- schedule must neither reject the history nor silently reprice its entrants.
  SELECT * INTO STRICT candidate FROM tournaments WHERE id='10000000-0000-0000-0000-000000000105';
  candidate.id := historical;
  candidate.started_at := now();
  candidate.schedule_id := NULL;
  INSERT INTO tournaments SELECT candidate.*;
  SELECT to_jsonb(t) - 'schedule_id' INTO STRICT before_row FROM tournaments t WHERE id=historical;
  UPDATE tournaments SET schedule_id=slot WHERE id=historical;
  IF fn_ca_midway_free_buy_slot_format(historical) IS DISTINCT FROM 'aiof'
    OR fn_ca_midway_free_buy_format(historical) IS DISTINCT FROM 'pko'
    OR (SELECT to_jsonb(t) - 'schedule_id' FROM tournaments t WHERE id=historical) IS DISTINCT FROM before_row THEN
    RAISE EXCEPTION 'started terms changed on schedule relink';
  END IF;
END $case$;
ROLLBACK;
SELECT 'PASS: scheduled Afternoon guarantee survives rejected INSERT and UPDATE; started terms remain intact';
