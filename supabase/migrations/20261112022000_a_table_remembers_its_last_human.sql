-- A GAME DOES NOT BREAK RIGHT AWAY AFTER A HUMAN LEAVES (Dan 2026-11-11:
-- "20-30 MINUTE MINIMUM TIME TO BREAK A GAME"). The engine keeps the
-- human-departure dwell in process memory, so a restart, reconnect or table
-- transfer could erase or shorten it. The table row itself now remembers when
-- a person last held one of its chairs, written at the seat event it belongs
-- to (sit down, stand up, sitting-out or leaving-state change), never by a
-- polling loop. The engine reads the greater of its memory and this column.
-- Also retunes the measured weekly rake mark to the relaunch forecast; the
-- mark is measurement only and no path reads it to suppress games.
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tables' AND column_name='last_human_seen_at') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='zz_note_human_seat_seen') AND (SELECT weekly_target = 600000 FROM public.horse_cash_rake_target WHERE union_id='fade0000-0000-0000-0000-000000000001'))
BEGIN;

ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS last_human_seen_at timestamptz;
COMMENT ON COLUMN public.tables.last_human_seen_at IS
  'When a person (profiles.is_horse false) last sat down, stood up, or changed sitting-out or leaving state here. The engine 20-30 minute human-departure dwell (Dan 2026-11-11) survives restarts by reading it.';

CREATE OR REPLACE FUNCTION public.fn_note_human_seat_seen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  uid uuid := COALESCE(NEW.user_id, OLD.user_id);
  tid uuid := COALESCE(NEW.table_id, OLD.table_id);
BEGIN
  IF uid IS NOT NULL AND tid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = uid AND COALESCE(p.is_horse, false) = false
  ) THEN
    UPDATE public.tables SET last_human_seen_at = now() WHERE id = tid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_note_human_seat_seen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_note_human_seat_seen ON public.table_seats;
CREATE TRIGGER zz_note_human_seat_seen
AFTER INSERT OR DELETE OR UPDATE OF leave_pending, is_sitting_out ON public.table_seats
FOR EACH ROW EXECUTE FUNCTION public.fn_note_human_seat_seen();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('table_seats', 'zz_note_human_seat_seen',
  'Observation only: stamps tables.last_human_seen_at at human seat lifecycle events (sit, stand, sitting-out or leaving change; never stack writes) so the 20-30 minute human-departure dwell (Dan 2026-11-11) survives engine restarts. Moves no chips and blocks nothing.');

UPDATE public.horse_cash_rake_target
SET weekly_target = 600000,
    source = 'horseUnionCashPlan.json weeklyRakeTarget (Dan 2026-11-11 relaunch: throttle retired, mark tripled to a 600,000 forecast; measurement only)',
    updated_at = now()
WHERE union_id = 'fade0000-0000-0000-0000-000000000001';

COMMIT;
