-- 20261101234057_auto_rabbit_hunt_setting_and_replay_runouts_persist.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-01, two Rabbit Hunt features in one breath:
--
--   1. "AUTO RUN RABBIT HUNT, to always show the run out at the end of a
--      hand." A per-player switch, VIP ONLY (Dan, same day: "both of these
--      features are VIP only" - the stored value is inert for a non-VIP,
--      exactly like all_in_squeeze). The client tile presses the same paid
--      reveal a thumb presses, automatically, the moment the offer lands.
--      The column defaults FALSE: a reveal can cost 5 diamonds, and a switch
--      that spends money on every hand must be opted INTO, never inherited.
--      (Compare rabbit_hunt_button, default TRUE, which only HIDES an offer.)
--
--   2. "If you are looking at a PREVIOUS HAND you can RABBIT HUNT, or run out
--      the board's cards that would have been there." The engine already
--      captures the runout per hand in memory, but the map holds two hands
--      and dies with the engine instance, so the replayer could only buy
--      inside a 90-second window. The engine now ALSO persists each captured
--      runout to public.rabbit_hunt_offers - the RLS-sealed, no-policy table
--      built for exactly this in 20260823141355 and left unwritten when the
--      economy moved in-engine - and revealRabbitHunt falls back to that row
--      for any hand the map no longer holds - for VIPs only ("both of
--      these features are VIP only"): the engine refuses a non-VIP a
--      previous hand before any charge, while the felt tile's own impulse
--      window stays open to everyone exactly as since 2026-08-25. This
--      migration gives that row
--      the dealt-in set, so the "you were not dealt into that hand" gate
--      holds on the DB path exactly as it does in memory, and finally
--      schedules the pruner that 20260823141355 created but never scheduled
--      (the engine is about to write this table on every early-ended hand
--      platform-wide, so unbounded growth stops being hypothetical).
--
-- WHAT THIS DOES NOT DO: it does not open the cards to anyone. The table
-- stays RLS-on with NO policies - PostgREST can read nothing from it - and
-- the cards still leave the server only through the engine's
-- revealRabbitHunt, one authenticated, charged caller at a time.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

-- @live-proof: EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_table_settings' AND column_name = 'auto_rabbit_hunt' AND column_default = 'false' AND is_nullable = 'NO')

BEGIN;

ALTER TABLE public.user_table_settings
  ADD COLUMN IF NOT EXISTS auto_rabbit_hunt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_table_settings.auto_rabbit_hunt IS
  'Auto Run Rabbit Hunt (Dan 2026-11-01): the felt tile presses the paid reveal itself on every early-ended hand. VIP ONLY ("both of these features are VIP only"): the stored value is inert for a non-VIP, like all_in_squeeze. Opt-in because each reveal is charged like a tap (VIP pool, pack, or 5 diamonds). Works with rabbit_hunt_button off; the tile mounts and immediately reveals.';

ALTER TABLE public.rabbit_hunt_offers
  ADD COLUMN IF NOT EXISTS eligible_user_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.rabbit_hunt_offers.eligible_user_ids IS
  'Who was dealt into the hand. The engine''s DB fallback (loadPersistedRabbitOffer) enforces the dealt-in gate from this set, so a spectator cannot buy a look at a replayed hand any more than a live one.';

COMMENT ON TABLE public.rabbit_hunt_offers IS
  'Remaining-deck cards for a finished hand, held server-side so the rabbit-hunt reveal can be paid for. Written by the engine at hand capture (again since 2026-11-01, for the previous-hand replayer); read back only by the engine''s revealRabbitHunt, which charges first. RLS on with no policies by design. Pruned after 1 day.';

-- Not DDL: cron.unschedule/cron.schedule write rows in cron.job, so they
-- trigger no PostgREST schema reload; they ride the same transaction.
-- sp_prune_rabbit_hunt_offers has existed since 20260823141355; no migration
-- ever scheduled it, which was harmless while nothing wrote the table. The
-- engine is about to write it on every early-ended hand, so the 1-day
-- retention the function promises has to actually run. Hourly, off the hour.
DO $$
BEGIN
  PERFORM cron.unschedule('ca-rabbit-hunt-offers-prune');
EXCEPTION WHEN OTHERS THEN
  NULL; -- first install: nothing to unschedule
END $$;

-- periodic-work: the prune IS the product: rabbit_hunt_offers promises 1-day
-- retention in its own COMMENT, the engine writes a row for every early-ended
-- hand platform-wide, and nothing upstream failed or was missed - without a
-- nightly-grade sweep the promise is simply never kept and the table grows
-- without bound.
SELECT cron.schedule(
  'ca-rabbit-hunt-offers-prune',
  '41 * * * *',
  'SELECT public.sp_prune_rabbit_hunt_offers(5000)'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ca-rabbit-hunt-offers-prune'
        AND schedule = '41 * * * *'
        AND command = 'SELECT public.sp_prune_rabbit_hunt_offers(5000)'
        AND active) <> 1 THEN
    RAISE EXCEPTION 'ca-rabbit-hunt-offers-prune is not registered exactly once';
  END IF;
END $$;

COMMIT;
