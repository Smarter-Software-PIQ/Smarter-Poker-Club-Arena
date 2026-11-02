-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id IN ('4e9ab7ad-50b0-4640-8859-f05777f62782','3c83257d-04c6-4cf9-8d4b-96162a8f26ff','011c5cd2-74af-4747-b67e-3497b8a3c0ff','b84fcc96-cf94-4b94-a76b-329d80a7f555','ce952f30-825a-4080-acd0-aa83a4503855','5435baf9-b626-4a94-8282-e927f02fc30a') AND t.addon_chips IS DISTINCT FROM t.starting_chips)
-- ============================================================================
-- SIX PRE-TRIGGER ADD-ONS PAY THE STARTING STACK (Dan 2026-11-01)
-- ============================================================================
--
-- Dan, verbatim: "AN ADD ON CAN NEVER EXCEED THE AMOUNT OF CHIPS THAT THE
-- TOURANMENT STARTED WITH, THE ADD ON SHOULD THE SAME AMOUNT OF CHIPS THAT YOU
-- START WITH IN THE TOURNAMENT, NEVER LESS!"
--
-- 20261102024023 corrected every unregistered unfinished add-on event at
-- 02:40Z. The serving engine (eed06fe5) still carries the old scheduler, which
-- wrote addon_chips = 2 x starting_chips for six Midway events it spawned
-- between 04:30Z and 07:07Z. The root guard, trigger zz_addon_pays_the_starting_stack
-- (20261102005209), installed in the 2026-11-02 daily window and corrects
-- every INSERT and UPDATE from then on, but it never revisits a row written
-- before it existed. These six rows are that gap, read from production at
-- 10:27Z: all REGISTERING, start 2026-11-05, ZERO registrations, so no player
-- term changes and the managed-lifecycle guard does not apply.
--
--   4e9ab7ad Night Owl Special (NLH)        10,000 -> add-on 20,000
--   3c83257d Six-Card Deep Night            30,000 -> add-on 60,000
--   011c5cd2 Union Late Night Turbo (NLH)    5,000 -> add-on 10,000
--   b84fcc96 Midnight Bounty (NLH)           5,000 -> add-on 10,000
--   ce952f30 Midnight Free Buy (NLH)         3,000 -> add-on 10,000
--   5435baf9 Omaha Thursday Graveyard       15,000 -> add-on 30,000
--
-- The UPDATE names exactly these ids, re-checks zero registrations, and the
-- transaction asserts exactly six rows changed or aborts. No DDL, no money.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $fix$
DECLARE n integer;
BEGIN
  UPDATE public.tournaments t SET addon_chips = t.starting_chips
   WHERE t.id IN ('4e9ab7ad-50b0-4640-8859-f05777f62782','3c83257d-04c6-4cf9-8d4b-96162a8f26ff',
                  '011c5cd2-74af-4747-b67e-3497b8a3c0ff','b84fcc96-cf94-4b94-a76b-329d80a7f555',
                  'ce952f30-825a-4080-acd0-aa83a4503855','5435baf9-b626-4a94-8282-e927f02fc30a')
     AND t.add_on_available AND t.ended_at IS NULL AND t.starting_chips > 0
     AND t.addon_chips IS DISTINCT FROM t.starting_chips
     AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN
    RAISE EXCEPTION 'ADDON_STRAGGLERS: expected exactly 6 unregistered rows, changed %', n;
  END IF;
END $fix$;
COMMIT;
