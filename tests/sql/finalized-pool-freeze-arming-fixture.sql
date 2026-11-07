-- Native PostgreSQL model of the disabled finalized-pool freeze on
-- public.tournaments, built to answer one question with a running database
-- instead of a reading: WHICH WRITES WOULD THE ARMED TRIGGER REFUSE?
--
-- The guard function is installed BYTE-EXACT from production
-- (md5(prosrc)=830423022877226ecdb6f417ae001ec1, 6999 bytes, read 2026-11-07)
-- and the trigger is created with production's EXACT column list, then ARMED.
-- The pin below fails the proof if the body here ever drifts from the one the
-- arming decision was taken against.
--
-- The second trigger models public.zz_ca_fund_overlay_on_lock: a
-- BEFORE UPDATE OF status trigger that assigns NEW.prize_pool to fund a
-- satellite's guaranteed seats at lock. Only the assignment matters here; the
-- bank, escrow and journal legs of the real function are not modelled because
-- the question is which statement the freeze trigger sees, not where the chips
-- came from.
--
-- No production row is read or written.
SET client_min_messages = warning;

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  name text,
  status text,
  prize_pool numeric,
  guaranteed_prize numeric,
  prize_pool_finalized boolean,
  payout_structure text,
  spin_multiplier numeric,
  bounty_pool numeric,
  satellite_target_id uuid,
  satellite_seats integer,
  buy_in_amount numeric,
  buy_in_fee numeric,
  total_rake numeric,
  current_players integer,
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE public.tournament_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid,
  user_id uuid,
  position integer,
  status text,
  is_satellite_qualifier boolean,
  source_satellite_id uuid
);

CREATE TABLE public.tournament_satellite_settlement_batches (
  tournament_id uuid,
  target_tournament_id uuid,
  settled_at timestamptz
);

CREATE TABLE public.tournament_satellite_entitlements (
  tournament_id uuid,
  target_tournament_id uuid,
  position integer,
  ticket_value numeric
);

CREATE TABLE public.tournament_payouts (
  tournament_id uuid,
  user_id uuid,
  position integer,
  source text
);

CREATE TABLE public.rake_records (
  tournament_id uuid,
  source text,
  rake_amount numeric,
  pot_size numeric,
  metadata jsonb
);

CREATE TABLE public.chip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text,
  tournament_id uuid,
  category text,
  amount numeric,
  from_type text,
  from_entity_id uuid,
  to_type text,
  to_entity_id uuid,
  metadata jsonb
);

CREATE FUNCTION public.trg_freeze_finalized_tournament_prize_pool()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_delta numeric;
  v_candidate_count integer := 0;
BEGIN

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
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND NOT COALESCE(NEW.prize_pool_finalized, false) THEN
    RAISE EXCEPTION
      'finalized tournament % prize pool cannot be reopened', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND (NEW.payout_structure IS DISTINCT FROM OLD.payout_structure
          OR NEW.spin_multiplier IS DISTINCT FROM OLD.spin_multiplier) THEN
    RAISE EXCEPTION
      'finalized tournament % payout structure and Spin draw cannot change', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND round(COALESCE(NEW.guaranteed_prize, 0), 2)
         IS DISTINCT FROM round(COALESCE(OLD.guaranteed_prize, 0), 2) THEN
    RAISE EXCEPTION 'finalized tournament % guarantee cannot change', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND round(COALESCE(NEW.prize_pool, 0), 2)
         IS DISTINCT FROM round(COALESCE(OLD.prize_pool, 0), 2) THEN
    v_delta := round(COALESCE(OLD.prize_pool, 0) - COALESCE(NEW.prize_pool, 0), 2);

    IF v_delta > 0
       AND COALESCE(NEW.prize_pool, 0) >= 0
       AND COALESCE(NEW.prize_pool_finalized, false)
       AND OLD.status = 'COMPLETING'
       AND OLD.satellite_target_id IS NOT NULL
       AND current_setting('app.atomic_satellite_settlement', true) = OLD.id::text
       /* No second column may hitchhike on the narrowly admitted debit. */
       AND (to_jsonb(NEW) - 'prize_pool') = (to_jsonb(OLD) - 'prize_pool') THEN
      SELECT count(*)::integer
        INTO v_candidate_count
        FROM public.tournament_satellite_settlement_batches b
        JOIN public.tournament_satellite_entitlements e
          ON e.tournament_id = b.tournament_id
         AND e.target_tournament_id = b.target_tournament_id
         AND e.target_tournament_id = OLD.satellite_target_id
         AND round(e.ticket_value, 2) = v_delta
        JOIN public.tournament_players source_player
          ON source_player.tournament_id = OLD.id
         AND source_player.position = e.position
         AND source_player.status IN ('winner', 'eliminated')
        JOIN public.tournament_players target_player
          ON target_player.tournament_id = e.target_tournament_id
         AND target_player.user_id = source_player.user_id
         AND COALESCE(target_player.is_satellite_qualifier, false)
         AND target_player.source_satellite_id = OLD.id
        JOIN public.tournaments target
          ON target.id = e.target_tournament_id
       WHERE b.tournament_id = OLD.id
         AND b.settled_at IS NULL
         AND round(
               GREATEST(COALESCE(target.buy_in_amount, 0), 0)
               + GREATEST(COALESCE(target.buy_in_fee, 0), 0),
               2
             ) = v_delta
         AND (
           SELECT count(*)::integer
             FROM public.rake_records target_rake
            WHERE target_rake.tournament_id = target.id
              AND target_rake.source = 'fn_award_satellite_seat'
              AND target_rake.metadata->>'satellite_id' = OLD.id::text
              AND target_rake.metadata->>'user_id' = source_player.user_id::text
              AND target_rake.metadata->>'registration_id' = target_player.id::text
         ) = CASE WHEN COALESCE(target.buy_in_fee, 0) > 0 THEN 1 ELSE 0 END
         AND (
           SELECT count(*)::integer
             FROM public.rake_records exact_target_rake
            WHERE exact_target_rake.tournament_id = target.id
              AND exact_target_rake.source = 'fn_award_satellite_seat'
              AND exact_target_rake.metadata->>'satellite_id' = OLD.id::text
              AND exact_target_rake.metadata->>'user_id' = source_player.user_id::text
              AND exact_target_rake.metadata->>'registration_id' = target_player.id::text
              AND round(exact_target_rake.rake_amount, 2)
                  = round(COALESCE(target.buy_in_fee, 0), 2)
              AND round(COALESCE(exact_target_rake.pot_size, 0), 2) = v_delta
         ) = CASE WHEN COALESCE(target.buy_in_fee, 0) > 0 THEN 1 ELSE 0 END
         /* At this exact instruction the target seat exists, but the source
            payout and transfer journal do not. A replay or second debit has
            either one and therefore cannot match this predicate. */
         AND NOT EXISTS (
           SELECT 1
             FROM public.tournament_payouts payout
            WHERE payout.tournament_id = OLD.id
              AND payout.user_id = source_player.user_id
              AND payout.position = e.position
              AND payout.source = 'satellite_seat'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public.chip_ledger ledger
            WHERE ledger.idempotency_key =
              'tourney:' || OLD.id::text || ':seat:'
              || source_player.user_id::text || ':pool_transfer'
         );
    END IF;

    IF v_candidate_count = 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finalized tournament % prize pool cannot change from % to %',
      NEW.id, OLD.prize_pool, NEW.prize_pool USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- THE BODY IS PRODUCTION'S, OR THIS PROOF PROVES NOTHING.
DO $pin$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'trg_freeze_finalized_tournament_prize_pool')
     IS DISTINCT FROM '830423022877226ecdb6f417ae001ec1' THEN
    RAISE EXCEPTION
      'FAIL the modelled guard body is not the installed production body';
  END IF;
END;
$pin$;

-- Production's exact trigger, ARMED (production has it tgenabled='D').
CREATE TRIGGER zzzz_freeze_finalized_tournament_prize_pool
  BEFORE UPDATE OF prize_pool, guaranteed_prize, prize_pool_finalized,
                   payout_structure, spin_multiplier
  ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION
    public.trg_freeze_finalized_tournament_prize_pool();

-- THE COLUMN LIST IS THE WHOLE POINT. If this attachment ever loses its
-- column list the proof below becomes a different experiment.
DO $shape$
BEGIN
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
       WHERE t.tgrelid = 'public.tournaments'::regclass
         AND t.tgname = 'zzzz_freeze_finalized_tournament_prize_pool')
     NOT LIKE '%BEFORE UPDATE OF prize_pool, guaranteed_prize, prize_pool_finalized, payout_structure, spin_multiplier ON public.tournaments%' THEN
    RAISE EXCEPTION 'FAIL the modelled trigger is not attached as production attaches it';
  END IF;
END;
$shape$;

-- Model of public.fn_ca_fund_overlay_on_lock: the satellite-seat overlay. It
-- assigns NEW.prize_pool from a BEFORE UPDATE OF status trigger, exactly as
-- the installed function does
-- ("NEW.prize_pool := round(v_pool_before + v_short, 2)").
CREATE FUNCTION public.fn_ca_fund_overlay_on_lock()
RETURNS trigger LANGUAGE plpgsql AS $overlay$
DECLARE
  v_seat_guarantee numeric;
  v_short numeric;
BEGIN
  IF NOT (COALESCE(OLD.status,'') IN ('ANNOUNCED','REGISTERING')
          AND NEW.status IN ('RUNNING','COMPLETING','COMPLETED')) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.satellite_seats,0) <= 0 OR NEW.satellite_target_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT round((COALESCE(t2.buy_in_amount,0) + COALESCE(t2.buy_in_fee,0))
               * NEW.satellite_seats, 2)
    INTO v_seat_guarantee
    FROM public.tournaments t2 WHERE t2.id = NEW.satellite_target_id;
  v_short := GREATEST(0, COALESCE(v_seat_guarantee,0)
                         - round(COALESCE(NEW.prize_pool,0),2));
  IF v_short <= 0 THEN RETURN NEW; END IF;
  NEW.prize_pool := round(COALESCE(NEW.prize_pool,0) + v_short, 2);
  RETURN NEW;
END;
$overlay$;

CREATE TRIGGER zz_ca_fund_overlay_on_lock
  BEFORE UPDATE OF status ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_fund_overlay_on_lock();

-- ── rows ────────────────────────────────────────────────────────────────────
-- Targets. 40 + 5 = a 45 seat.
INSERT INTO public.tournaments
  (id, name, status, prize_pool, guaranteed_prize, prize_pool_finalized,
   payout_structure, spin_multiplier, bounty_pool, satellite_target_id,
   satellite_seats, buy_in_amount, buy_in_fee, total_rake, current_players,
   updated_at)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001','Target A','REGISTERING',
   0,0,false,'[{"place":1,"percentage":100}]',NULL,0,NULL,0,40,5,0,0,
   '2026-11-07 00:00:00+00'),
  ('aaaa0000-0000-0000-0000-000000000002','Target B','REGISTERING',
   0,0,false,'[{"place":1,"percentage":100}]',NULL,0,NULL,0,40,5,0,0,
   '2026-11-07 00:00:00+00'),
  -- S1: a satellite whose pool is ALREADY finalized, locking into RUNNING.
  ('bbbb0000-0000-0000-0000-000000000001','Sat Lock Plain','REGISTERING',
   60,0,true,'[{"place":1,"percentage":100}]',NULL,0,
   'aaaa0000-0000-0000-0000-000000000001',2,5,0,0,6,
   '2026-11-07 00:00:00+00'),
  -- S2: the same row image, for the statement that names a guarded column.
  ('bbbb0000-0000-0000-0000-000000000002','Sat Lock Named','REGISTERING',
   60,0,true,'[{"place":1,"percentage":100}]',NULL,0,
   'aaaa0000-0000-0000-0000-000000000001',2,5,0,0,6,
   '2026-11-07 00:00:00+00'),
  -- S3/S4: an ordinary finalized event.
  ('cccc0000-0000-0000-0000-000000000001','Finalized Event','COMPLETED',
   100,100,true,'[{"place":1,"percentage":60},{"place":2,"percentage":40}]',
   3,0,NULL,0,10,1,10,20,'2026-11-07 00:00:00+00'),
  -- S5: the Morning Free Buy shape: finalized at 0, owner overlay after.
  ('cccc0000-0000-0000-0000-000000000002','Free Buy','COMPLETED',
   0,0,true,'[{"place":1,"percentage":100}]',NULL,0,NULL,0,0,0,0,80,
   '2026-11-07 00:00:00+00'),
  -- S6/S7/S8: the satellite-settlement debit the existing door admits.
  ('dddd0000-0000-0000-0000-000000000001','Sat Settling','COMPLETING',
   90,0,true,'[{"place":1,"percentage":100}]',NULL,0,
   'aaaa0000-0000-0000-0000-000000000002',2,5,0,0,6,
   '2026-11-07 00:00:00+00'),
  -- S9: the same corroboration, wrong state.
  ('dddd0000-0000-0000-0000-000000000002','Sat Running','RUNNING',
   90,0,true,'[{"place":1,"percentage":100}]',NULL,0,
   'aaaa0000-0000-0000-0000-000000000002',2,5,0,0,6,
   '2026-11-07 00:00:00+00');

-- Corroborating rows for the satellite-settlement door, for both the
-- COMPLETING row and the RUNNING row.
INSERT INTO public.tournament_satellite_settlement_batches
  (tournament_id, target_tournament_id, settled_at)
VALUES ('dddd0000-0000-0000-0000-000000000001',
        'aaaa0000-0000-0000-0000-000000000002', NULL),
       ('dddd0000-0000-0000-0000-000000000002',
        'aaaa0000-0000-0000-0000-000000000002', NULL);

INSERT INTO public.tournament_satellite_entitlements
  (tournament_id, target_tournament_id, position, ticket_value)
VALUES ('dddd0000-0000-0000-0000-000000000001',
        'aaaa0000-0000-0000-0000-000000000002', 1, 45),
       ('dddd0000-0000-0000-0000-000000000002',
        'aaaa0000-0000-0000-0000-000000000002', 1, 45);

INSERT INTO public.tournament_players
  (id, tournament_id, user_id, position, status,
   is_satellite_qualifier, source_satellite_id)
VALUES
  ('eeee0000-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-000000000001',
   'ffff0000-0000-0000-0000-000000000001', 1, 'winner', false, NULL),
  ('eeee0000-0000-0000-0000-000000000002',
   'aaaa0000-0000-0000-0000-000000000002',
   'ffff0000-0000-0000-0000-000000000001', NULL, 'registered', true,
   'dddd0000-0000-0000-0000-000000000001'),
  ('eeee0000-0000-0000-0000-000000000003',
   'dddd0000-0000-0000-0000-000000000002',
   'ffff0000-0000-0000-0000-000000000002', 1, 'winner', false, NULL),
  ('eeee0000-0000-0000-0000-000000000004',
   'aaaa0000-0000-0000-0000-000000000002',
   'ffff0000-0000-0000-0000-000000000002', NULL, 'registered', true,
   'dddd0000-0000-0000-0000-000000000002');

INSERT INTO public.rake_records
  (tournament_id, source, rake_amount, pot_size, metadata)
VALUES
  ('aaaa0000-0000-0000-0000-000000000002','fn_award_satellite_seat',5,45,
   jsonb_build_object(
     'satellite_id','dddd0000-0000-0000-0000-000000000001',
     'user_id','ffff0000-0000-0000-0000-000000000001',
     'registration_id','eeee0000-0000-0000-0000-000000000002')),
  ('aaaa0000-0000-0000-0000-000000000002','fn_award_satellite_seat',5,45,
   jsonb_build_object(
     'satellite_id','dddd0000-0000-0000-0000-000000000002',
     'user_id','ffff0000-0000-0000-0000-000000000002',
     'registration_id','eeee0000-0000-0000-0000-000000000004'));
