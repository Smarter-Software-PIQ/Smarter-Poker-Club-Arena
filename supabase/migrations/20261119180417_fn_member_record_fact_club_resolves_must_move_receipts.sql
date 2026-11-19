-- 20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql
--
-- WHAT THIS CHANGES, AND WHY:
-- When a player buys into a Feeder table funded by their club and moves via
-- must-move / break / balance / swap (`fn_cash_seat_move_execute`) to a Main
-- table, no new chip-ledger buy-in occurs, so `cash_participant_funding_receipts`
-- has no row for the destination `table_id`. Instead, `fn_cash_seat_move_execute`
-- writes an immutable receipt to `public.cash_seat_move_receipts` with the
-- preserved funding `club_id`.
--
-- Previously, `public.fn_member_record_fact_club(f ca_hand_facts)` only queried
-- `cash_participant_funding_receipts` by `table_id`, missing moved seats and
-- falling back to post-commit `rake_attributions` (which lags insert time) and
-- then `f.club_id` (the union table's club) for un-raked hands.
--
-- This migration:
--   1. Builds a concurrent index on `public.cash_seat_move_receipts
--      (to_table_id, player_id, created_at DESC, move_id DESC)` outside the
--      transaction so live seat moves are never blocked.
--   2. Updates `public.fn_member_record_fact_club(public.ca_hand_facts)` to
--      resolve the most recent arrival on `f.table_id` at or before `f.played_at`
--      across BOTH `cash_participant_funding_receipts` (`operation_kind = 'buyin'`)
--      AND `cash_seat_move_receipts` (`to_table_id`, `player_id`, `created_at`),
--      preserving exact `SECURITY DEFINER`, `search_path`, and `{postgres=X/postgres}` ACL.
--
-- @live-proof: EXISTS(SELECT 1 FROM pg_index WHERE indexrelid = 'public.cash_seat_move_receipts_dest_player_at_idx'::regclass AND indisvalid AND indisready)
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_member_record_fact_club' AND pg_get_functiondef(p.oid) ILIKE '%cash_seat_move_receipts%' AND p.proacl::text = '{postgres=X/postgres}')

CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_seat_move_receipts_dest_player_at_idx
  ON public.cash_seat_move_receipts (to_table_id, player_id, created_at DESC, move_id DESC);

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.cash_seat_move_receipts_dest_player_at_idx'::regclass
      AND indisvalid
      AND indisready
  ) THEN
    RAISE EXCEPTION 'cash_seat_move_receipts_dest_player_at_idx must be valid and ready';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_member_record_fact_club(f public.ca_hand_facts) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT a.club_id
     FROM (
       (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
        FROM public.cash_participant_funding_receipts x
        WHERE f.tournament_id IS NULL
          AND x.operation_kind = 'buyin'
          AND x.table_id = f.table_id
          AND x.account_entity_id = f.user_id
          AND x.seat_joined_at <= f.played_at
        ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC
        LIMIT 1)
       UNION ALL
       (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
        FROM public.cash_seat_move_receipts m
        WHERE f.tournament_id IS NULL
          AND m.to_table_id = f.table_id
          AND m.player_id = f.user_id
          AND m.created_at <= f.played_at
        ORDER BY m.created_at DESC, m.move_id DESC
        LIMIT 1)
     ) a
     ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC
     LIMIT 1),
    (SELECT tp.club_id FROM public.tournament_players tp WHERE tp.tournament_id = f.tournament_id AND tp.user_id = f.user_id),
    (SELECT ra.club_id FROM public.rake_attributions ra WHERE ra.hand_id = f.hand_id AND ra.player_id = f.user_id),
    f.club_id);
$$;

REVOKE ALL ON FUNCTION public.fn_member_record_fact_club(public.ca_hand_facts) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
