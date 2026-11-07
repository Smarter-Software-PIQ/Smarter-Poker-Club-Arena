-- 20261107130207_welcome_back_awards_sees_every_paid_player.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every remote branch.
--
-- THE 25-CHIP WELCOME-BACK PROMO IS PAID ONCE PER PLAYER, AND ONE GUARD SAYS SO.
--
-- Owner report, 2026-11-07: "YOU SENT THE 25 CHIPS TO ALL THE PLAYERS TWICE."
-- 32 members held 50. 29 still had the duplicate and 725 chips were returned
-- (20261107071720); 3 had spent it and were left alone on the owner's ruling
-- ("IF A PLAYER HAS ALREADY SPENT IT ... DON'T WORRY ABOUT IT").
--
-- THE CAUSE, read from rows, not guessed.
-- fn_sp_signup_welcome_back_run (20261104145956) pays this promo and is
-- correctly idempotent: it skips any player with an 'awarded' row in
-- sp_signup_welcome_back_awards, derives v_op from the player id so
-- fn_promo_disburse answers a replay, and keys the awards table on user_id.
-- That guard never failed. It was BYPASSED.
--
-- Of the 160 grants on the ledger, 127 came from agent backfills through the
-- management API that called fn_promo_disburse DIRECTLY with fresh random
-- op_ids, and 33 from the live runner. 128 members were paid; only 33 had an
-- awards row. So the runner's guard could not see the other 95, and when it
-- next found one eligible it paid again - which is precisely what happened to
-- the 9 members paid at 22:08 by a backfill and again at 22:17 by the runner.
--
-- THE REAL EXPOSURE WAS AHEAD OF US, NOT BEHIND. All 95 unguarded members are
-- past the 24-hour mark and 53 sit inside the runner's since-launch window, so
-- the next runs would have paid out another ~1,325 chips of duplicates, with
-- the remaining 42 exposed the moment p_since is widened. This migration
-- closes that by making the existing guard see every member who has been paid.
--
-- WHAT THIS DOES
--   1. Drops ca_union_promo_campaign_claims and fn_ca_union_promo_grant_once
--      (recorded in 20261107124625). They were a SECOND guard for a campaign
--      that already had one. Two guards that must agree about the same
--      campaign is the defect of CLAUDE.md 10.84 - three lists had to agree
--      and nothing checked them - and the next agent would have had to know
--      which of the two was authoritative. The platform's own guard is
--      sp_signup_welcome_back_awards, and it is the only one left.
--   2. Backfills an 'awarded' row for every member the ledger shows was paid
--      this promo and who has no awards row, carrying the deterministic
--      op_id md5('signup-welcome-back:' || user_id) that the runner derives,
--      so both the awards guard AND fn_promo_disburse's op_id idempotency
--      now refuse a second payment to these members.
--
-- No chips move here. This migration writes no balance and no ledger leg: it
-- repairs the RECORD of payments already made, so the live path stops
-- re-paying them. It is not a repair job and nothing is scheduled (10.12) -
-- the fix is that the runner's guard is now complete.
--
-- Scans are bounded by created_at (indexed) because chip_ledger is 26M rows
-- and has no (category, description) index; the first grant was 2026-11-04.
--
-- docs/changelog/2026-11-07-the-union-promo-is-paid-once-per-player.md

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One campaign, one guard: the parallel one goes
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_ca_union_promo_grant_once(uuid, uuid, numeric, text, uuid, text);
DROP TABLE IF EXISTS public.ca_union_promo_campaign_claims;
DELETE FROM public.ca_money_rpc_registry WHERE proname = 'fn_ca_union_promo_grant_once';

-- ---------------------------------------------------------------------------
-- 2. The guard sees every member who has already been paid
-- ---------------------------------------------------------------------------
INSERT INTO public.sp_signup_welcome_back_awards
  (user_id, signed_up_at, status, amount, union_id, club_id, op_id,
   transaction_id, awarded_at, last_error)
SELECT g.user_id,
       COALESCE(p.created_at, g.first_paid_at),
       'awarded',
       25,
       g.union_id,
       g.club_id,
       md5('signup-welcome-back:' || g.user_id::text)::uuid,
       t.id,
       g.first_paid_at,
       'backfilled 2026-11-07: paid by a management-API backfill that did not write this row; see migration 20261107130207'
  FROM (
    SELECT DISTINCT ON (l.to_entity_id)
           l.to_entity_id AS user_id,
           l.union_id,
           l.club_id,
           l.created_at   AS first_paid_at
      FROM public.chip_ledger l
     WHERE l.created_at >= '2026-11-04'
       AND l.amount = 25
       AND l.category = 'promo'
       AND l.description = 'Union Promo Disbursement'
       AND l.from_type = 'union_wallet'
       AND l.to_type = 'player_wallet'
     ORDER BY l.to_entity_id, l.created_at
  ) g
  LEFT JOIN public.profiles p ON p.id = g.user_id
  LEFT JOIN public.chip_transactions t
         ON t.to_user_id = g.user_id
        AND t.transaction_type = 'promo_disbursement'
        AND t.created_at >= '2026-11-04'
        AND t.amount = 25
 WHERE NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                    WHERE a.user_id = g.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- Every member the ledger shows was paid this promo now has exactly one
-- awards row, so the runner can never pay any of them again. If this count is
-- ever non-zero the guard has been bypassed again.
DO $$
DECLARE v_unguarded integer;
BEGIN
  SELECT count(*) INTO v_unguarded
    FROM (SELECT DISTINCT l.to_entity_id AS user_id
            FROM public.chip_ledger l
           WHERE l.created_at >= '2026-11-04'
             AND l.amount = 25
             AND l.category = 'promo'
             AND l.description = 'Union Promo Disbursement'
             AND l.from_type = 'union_wallet'
             AND l.to_type = 'player_wallet') g
   WHERE NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                      WHERE a.user_id = g.user_id);
  IF v_unguarded <> 0 THEN
    RAISE EXCEPTION 'welcome-back guard still blind to % paid member(s)', v_unguarded;
  END IF;
END $$;

COMMENT ON TABLE public.sp_signup_welcome_back_awards IS
  'Welcome-back chips (Dan 2026-11-04): one row per real player who signed up, had not played a hand after 24 hours, and was offered 25 free chips from the Midway Union promo wallet. status awarded = chips landed; no_club = waiting for the player to join a Midway Union club. THIS IS THE ONLY GUARD FOR THIS PROMO (2026-11-07): a sender that pays these chips without writing its row here will cause a duplicate payment, which is how 32 members were paid twice on 2026-11-05.';

COMMIT;
