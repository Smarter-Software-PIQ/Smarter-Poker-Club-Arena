-- @install-window: daily-maintenance
-- The 2026-11-17 shape: it calls a function production does not have and no
-- earlier queued file creates (there: public.fn_ca_promo_integrity_immutable()).
BEGIN;
CREATE TRIGGER window_rehearsal_seats_immutable BEFORE UPDATE ON public.window_rehearsal_seats
  FOR EACH ROW EXECUTE FUNCTION public.fn_window_rehearsal_missing_immutable();
COMMIT;
