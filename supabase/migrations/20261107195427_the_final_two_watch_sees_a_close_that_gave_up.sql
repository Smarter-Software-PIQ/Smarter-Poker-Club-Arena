-- 20261107195427_the_final_two_watch_sees_a_close_that_gave_up
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 19:54:27 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- THE FINAL-TWO WATCH SEES A CLOSE THAT GAVE UP (2026-11-07).
--
-- fn_ca_bounty_only_final_two_watch exempts any event with a row in
-- ca_bounty_only_final_two_refusals as "the rule working". The engine
-- (server/src/tournament/bountyOnlyFinalTwo.ts) writes that row for two
-- different things: a rule refusal, and a close whose retries ran out -
-- reason "...; gave up after N tries in Ns". The second is not the rule
-- working; it is the miss the rule exists to prevent, and the runner-up loses
-- their own head exactly as in any other miss. The engine already knows this
-- for the "field passed two" miss and deliberately writes no refusal row so
-- it stays visible; an exhausted retry got no such care.
--
-- Measured on production 2026-11-07, every completed bounty-only PKO:
--   4 ended before 2026-11-06 12:00Z, the watch's v_since (the rule's first
--     serving engine) - excluded by design, not blind;
--   b3ae52ef - raised closed_without_final_two (the watch working);
--   c1b3fa5a - silent: refusal "authority_unreachable: finishing place 2 ...
--     is already held by ...; gave up after 8 tries in 74s".
-- So of the two events the watch should judge it saw one; this file makes it
-- see the other.
--
-- A MADE-GOOD MISS IS NO LONGER A BREACH. The watch re-raises any breach
-- inside its 14-day window whenever no open alert exists, so an alert closed
-- after the runner-up is paid would come straight back. The question the
-- breach asks is whether the runner-up got their own head; a settled
-- make-good leg answers it. The leg is found by its exact key
-- 'bounty-only-final-two-make-good:<event>:<place-2 user>' (the key
-- 20261107140005 writes), one index probe, never a prefix scan.
--
-- The one open alert for a made-good miss (b3ae52ef, alert 49b95c40-b055-
-- 462b-8b6e-bca96455d911) is closed with the make-good's own reference;
-- bounded to that id and re-checked, a re-run closes 0.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_bounty_only_final_two_watch(timestamptz)'::regprocedure))='3e17a2d7c043ec8594946563d55d3820' AND (SELECT resolved IS TRUE FROM public.financial_alerts WHERE id='49b95c40-b055-462b-8b6e-bca96455d911')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $watch$
DECLARE
  c_fn constant text := 'public.fn_ca_bounty_only_final_two_watch(timestamptz)';
  a1 constant text := E'          WHERE f.tournament_id = ev.id) AS refusal\n';
  r1 constant text := E'          WHERE f.tournament_id = ev.id) AS refusal,\n'
    || E'        -- A runner-up already paid their own head by the make-good\n'
    || E'        -- (20261107140005) leaves nothing owed: the exact key, never a prefix.\n'
    || E'        EXISTS (SELECT 1 FROM public.chip_ledger l\n'
    || E'                 WHERE l.idempotency_key = ANY (ARRAY(\n'
    || E'                   SELECT ''bounty-only-final-two-make-good:'' || ev.id::text || '':'' || tp.user_id::text\n'
    || E'                     FROM public.tournament_players tp\n'
    || E'                    WHERE tp.tournament_id = ev.id AND tp.position = 2))) AS made_good\n';
  a2 constant text := E'       WHERE NOT closed AND entrants >= 3 AND refusal IS NULL\n';
  r2 constant text := E'       WHERE NOT closed AND entrants >= 3 AND NOT made_good\n'
    || E'         -- A close that ran out of retries ("gave up after N tries") is\n'
    || E'         -- the miss itself, not a rule refusal (20261107195427).\n'
    || E'         AND (refusal IS NULL OR refusal LIKE ''%gave up after %'')\n';
  d text; m jsonb; m2 jsonb; n integer;
BEGIN
  d := pg_get_functiondef(c_fn::regprocedure);
  IF md5(d) IS DISTINCT FROM '63ae46e41c349dd5fe798c0d2f0a30ee' THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_PREIMAGE_DRIFT %', md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1,'')))/length(a1)<>1 OR (length(d)-length(replace(d,a2,'')))/length(a2)<>1 THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_ANCHORS' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m FROM pg_proc WHERE oid=c_fn::regprocedure;
  EXECUTE replace(replace(d,a1,r1),a2,r2);
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m2 FROM pg_proc WHERE oid=c_fn::regprocedure;
  IF m2 IS DISTINCT FROM m OR md5(pg_get_functiondef(c_fn::regprocedure)) IS DISTINCT FROM '3e17a2d7c043ec8594946563d55d3820' THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_POSTIMAGE %', md5(pg_get_functiondef(c_fn::regprocedure)) USING ERRCODE='55000';
  END IF;

  UPDATE public.financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = COALESCE(NULLIF(a.resolution,'') || ' | ','')
           || 'Made good: the runner-up was paid their own head by migration 20261107140005 (ledger key bounty-only-final-two-make-good:'
           || (a.context->>'tournament_id') || ':' || tp.user_id::text || '); the watch now treats a made-good miss as settled (20261107195427).'
    FROM public.tournament_players tp
   WHERE a.id = '49b95c40-b055-462b-8b6e-bca96455d911'
     AND a.source = 'fn_ca_bounty_only_final_two_watch' AND a.resolved IS NOT TRUE
     AND a.context->>'breach' = 'closed_without_final_two'
     AND tp.tournament_id = (a.context->>'tournament_id')::uuid AND tp.position = 2
     AND EXISTS (SELECT 1 FROM public.chip_ledger l
                  WHERE l.idempotency_key = 'bounty-only-final-two-make-good:' || (a.context->>'tournament_id') || ':' || tp.user_id::text
                    AND l.to_type = 'player_wallet' AND l.to_entity_id = tp.user_id AND l.category = 'settlement');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0,1) OR (SELECT resolved IS NOT TRUE FROM public.financial_alerts WHERE id='49b95c40-b055-462b-8b6e-bca96455d911') THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_MADE_GOOD_ALERT_NOT_CLOSED' USING ERRCODE='55000';
  END IF;
END $watch$;

COMMIT;
