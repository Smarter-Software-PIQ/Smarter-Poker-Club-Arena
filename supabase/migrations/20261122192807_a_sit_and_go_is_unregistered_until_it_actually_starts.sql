-- 20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts
--
-- VERIFY ONLY. This file changes nothing.
--
-- It first carried anchored edits giving every non-heads-up sng-v1 event an
-- actual-start unregistration authority under a second name. A
-- parallel lane shipped the same root fix as
-- 20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id
-- ('sng_actual_start'), and the merged-migration dispatcher installed that one
-- first, at 22:10 UTC on 2026-11-22. This file's install then refused, as
-- designed, with "fn_ca_unregister_tournament_player_exact anchor authority was
-- expected exactly once": its anchors no longer existed, so it rolled back and
-- changed nothing.
--
-- A merged migration must be live (tests/a-merged-migration-must-be-live.law.test.ts),
-- and a second authority for the same rule would be two names for one fact. So
-- this version now only proves the installed rule is present, and records
-- itself. The rule is pinned at source by
-- tests/a-sit-and-go-is-unregistered-until-it-actually-starts.law.test.ts.
--
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure), 'sng_actual_start') > 0 AND strpos(pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') > 0 AND strpos(pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') > 0 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tournament_unregistration_receipts'::regclass AND conname = 'tournament_unregistration_actual_start_check' AND strpos(pg_get_constraintdef(oid), 'sng_actual_start') > 0)

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $verify$
BEGIN
  IF strpos(pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure), 'sng_actual_start') = 0
     OR strpos(pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') = 0
     OR strpos(pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') = 0
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.tournament_unregistration_receipts'::regclass
          AND conname = 'tournament_unregistration_actual_start_check'
          AND strpos(pg_get_constraintdef(oid), 'sng_actual_start') > 0) THEN
    RAISE EXCEPTION 'sit and go actual-start unregistration (20261122185915) is not installed';
  END IF;
END $verify$;

COMMIT;
