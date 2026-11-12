-- Owner relaunch, November 11 2026: the 1/2 games run full time again with no
-- restriction on how many games are open (the weekly rake throttle is
-- retired; the engine plan now schedules every plan game around the clock at
-- triple the reduced activity scale). Re-enable the two 1/2 Classic PLO games
-- that were switched off under that throttle so the fleet can seat them.
-- @live-proof: (SELECT bool_and(enabled) FROM public.cash_games WHERE id IN ('a20ceacc-a4c3-4275-948d-3d34dda890d7','4a762a3c-fcbe-450f-806a-b83cfd974a62'))
BEGIN;

UPDATE public.cash_games
SET enabled = true, updated_at = now()
WHERE id IN (
  'a20ceacc-a4c3-4275-948d-3d34dda890d7', -- PLO4 1/2 Classic
  '4a762a3c-fcbe-450f-806a-b83cfd974a62'  -- PLO5 1/2 Classic
)
  AND enabled = false;

COMMIT;
