-- Incident 075013fd: the owner's Free Buy hold lifts.
--
-- Dan's ruling (2026-11-17 21:30 CT): no Free Buy starts until the hand-delay
-- problem is fixed. The fixes are live: the database lanes (#11310/#11321,
-- #11322, #11339, #11365, #11381, #11329, #11361, #11300) and the engine
-- build 7add8b42c (containing #11302, #11314, #11366). The production
-- hand-gap watch (#11363) measured every hand shape within its owed beats
-- plus the 250 ms budget on that build before this was merged.
--
-- Only the owner function writes the switch; it appends its own audit row.
-- Deferred Free Buys start through the normal path at their deferred times.
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT public.fn_ca_owner_set_free_buy_start_pause(
  false,
  'Incident 075013fd: hand-delay fixes installed and measured within budget on engine 7add8b42c; owner hold of 2026-11-17 21:30 CT lifts.',
  'Dan (owner hold 2026-11-17 21:30 CT), lifted by migration 20261119144500 after verification'
);
DO $$
BEGIN
  IF (SELECT paused FROM public.ca_free_buy_start_pause) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FREE_BUY_HOLD_DID_NOT_LIFT';
  END IF;
END
$$;
COMMIT;
