-- Owner relaunch, November 11 2026: the 1/2 games run full time again with no
-- restriction on how many games are open (the weekly rake throttle is
-- retired; the engine plan now schedules every plan game around the clock at
-- triple the reduced activity scale). Re-enable the two 1/2 Classic PLO games
-- that was switched off under that throttle so the fleet can seat it.
-- PLO5 1/2 stays with its one enabled game: PLO5 1/2 Madness (template
-- classic) is live full time, and cash_games_one_per_key allows exactly one
-- enabled game per (club, variant, sb, bb, template) - the owner's
-- one-game-per-stake rule (2026-10-23) - so PLO5 1/2 Classic is not enabled.
-- @live-proof: (SELECT bool_and(enabled) FROM public.cash_games WHERE id IN ('a20ceacc-a4c3-4275-948d-3d34dda890d7','050f0735-1eac-45b3-90f8-3e50ab72dc04'))
BEGIN;

UPDATE public.cash_games
SET enabled = true, updated_at = now()
WHERE id = 'a20ceacc-a4c3-4275-948d-3d34dda890d7' -- PLO4 1/2 Classic
  AND enabled = false;

COMMIT;
