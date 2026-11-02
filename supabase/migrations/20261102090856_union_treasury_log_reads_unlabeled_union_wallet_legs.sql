-- The union treasury log reads unlabeled union wallet legs (verification, 2026-11-02).
--
-- Found reconciling the Rake Treasury from 2026-10-01: the ledger wrote the
-- 2026-10-01 22:43 and 2026-10-02 06:11 / 10:04 UTC rakeback runs as
-- union_wallet legs with NO from_label (rakeback 387,082.68 + 117,192.35 +
-- 339,323.01 and a 43,012.21 transfer to the Union Bank, 886,610.25 in all).
-- fn_union_treasury_legs named a union wallet only by its label, so those outs
-- belonged to no wallet and the Rake Treasury log was 886,610.25 short against
-- the wallet's own balance history. Every later out carries its label.
--
-- Fix at the line that produced it: an unlabeled union wallet leg is named by
-- union_wallet_transactions, the union's own wallet ledger - the one wallet
-- that union debited (for an out) or credited (for an in) in the same
-- transaction. Zero or several candidate wallets resolve to nothing, never to
-- a guess. The labelled path is unchanged, and the promo sweep (labelled by
-- its category) keeps its existing branch ahead of this one.
--
-- The days whose legs predate the labels are then derived again by the same
-- idempotent writer: their closed-hour markers are cleared so the 5-minute
-- tick closes them again (bricks are replaced, missing itemized rows are
-- inserted, existing rows are untouched). No ledger record is changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_union_treasury_legs(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  ledger_id uuid, created_at timestamptz, side text, union_id uuid, wallet_key text,
  amount numeric, category text, cp_type text, cp_label text, cp_id uuid,
  performed_by uuid, description text, balance_after numeric,
  club_id uuid, tournament_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH spin AS (
    SELECT sp.id, COALESCE(u.id, uc.union_id) AS union_id
      FROM spin_bonus_pools sp
      LEFT JOIN unions u ON u.id = sp.club_id
      LEFT JOIN union_clubs uc ON uc.club_id = sp.club_id
     WHERE sp.owner_kind = 'union'
  ),
  bbj AS (SELECT id, union_id FROM bbj_pools WHERE union_id IS NOT NULL),
  l AS (
    SELECT * FROM chip_ledger c
     WHERE c.created_at >= p_from AND c.created_at < p_to
       AND COALESCE(c.status, 'posted') = 'posted'
       AND (c.from_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
         OR c.to_type   IN ('union_bank','union_wallet','bbj_pool','spin_reserve'))
  ),
  outs AS (
    SELECT l.id, l.created_at, 'out'::text AS side,
      CASE
        WHEN l.from_type = 'union_bank' THEN l.from_entity_id
        WHEN l.from_type = 'bbj_pool'   THEN (SELECT b.union_id FROM bbj b WHERE b.id = l.from_entity_id)
        WHEN l.from_type = 'spin_reserve' THEN (SELECT s.union_id FROM spin s WHERE s.id = l.from_entity_id)
        ELSE l.union_id END AS union_id,
      CASE
        WHEN l.from_type = 'union_bank' OR l.from_label = 'union_wallets.chip_balance' THEN 'union_bank'
        WHEN l.from_label = 'union_wallets.rake_wallet'  THEN 'rake_treasury'
        WHEN l.from_label = 'union_wallets.promo_wallet' THEN 'promo'
        WHEN l.from_label = 'union_wallets.spin_reserve_wallet' THEN 'spins_treasury'
        WHEN l.from_type = 'spin_reserve' THEN 'spins_treasury'
        WHEN l.from_type = 'bbj_pool' AND l.from_label = 'bbj_pools.backup_balance' THEN 'backup_bbj'
        WHEN l.from_type = 'bbj_pool' AND l.from_label = 'bbj_pools.main_balance'   THEN 'main_bbj'
        -- An unlabeled union wallet leg is named by the union's own wallet
        -- ledger: the one wallet that union debited in the same transaction.
        WHEN l.from_type = 'union_wallet' AND l.from_label IS NULL THEN
          (SELECT CASE min(u.wallet) WHEN 'chip_balance' THEN 'union_bank'
                                     WHEN 'rake_wallet' THEN 'rake_treasury'
                                     WHEN 'promo_wallet' THEN 'promo'
                                     WHEN 'spin_reserve_wallet' THEN 'spins_treasury' END
             FROM union_wallet_transactions u
            WHERE u.union_id = l.union_id AND u.created_at = l.created_at AND u.direction = 'debit'
           HAVING count(DISTINCT u.wallet) = 1)
      END AS wallet_key,
      l.amount, l.category, l.to_type, l.to_label, l.to_entity_id,
      l.performed_by, COALESCE(l.description, l.notes), l.post_from_balance,
      l.club_id, l.tournament_id
    FROM l
    WHERE l.from_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
  ),
  ins AS (
    SELECT l.id, l.created_at, 'in'::text,
      CASE
        WHEN l.to_type = 'union_bank' THEN l.to_entity_id
        WHEN l.to_type = 'bbj_pool'   THEN (SELECT b.union_id FROM bbj b WHERE b.id = l.to_entity_id)
        WHEN l.to_type = 'spin_reserve' THEN (SELECT s.union_id FROM spin s WHERE s.id = l.to_entity_id)
        ELSE l.union_id END,
      CASE
        WHEN l.to_type = 'union_bank' OR l.to_label = 'union_wallets.chip_balance' THEN 'union_bank'
        WHEN l.to_label = 'union_wallets.rake_wallet'  THEN 'rake_treasury'
        WHEN l.to_label = 'union_wallets.promo_wallet' THEN 'promo'
        WHEN l.to_type = 'union_wallet' AND l.to_label IS NULL AND l.category = 'promo' THEN 'promo'
        WHEN l.to_label = 'union_wallets.spin_reserve_wallet' THEN 'spins_treasury'
        WHEN l.to_type = 'spin_reserve' THEN 'spins_treasury'
        WHEN l.to_type = 'bbj_pool' AND l.to_label = 'bbj_pools.backup_balance' THEN 'backup_bbj'
        WHEN l.to_type = 'bbj_pool' AND l.to_label = 'bbj_pools.main_balance'   THEN 'main_bbj'
        WHEN l.to_type = 'union_wallet' AND l.to_label IS NULL THEN
          (SELECT CASE min(u.wallet) WHEN 'chip_balance' THEN 'union_bank'
                                     WHEN 'rake_wallet' THEN 'rake_treasury'
                                     WHEN 'promo_wallet' THEN 'promo'
                                     WHEN 'spin_reserve_wallet' THEN 'spins_treasury' END
             FROM union_wallet_transactions u
            WHERE u.union_id = l.union_id AND u.created_at = l.created_at AND u.direction = 'credit'
           HAVING count(DISTINCT u.wallet) = 1)
      END,
      l.amount, l.category, l.from_type, l.from_label, l.from_entity_id,
      l.performed_by, COALESCE(l.description, l.notes), l.post_to_balance,
      l.club_id, l.tournament_id
    FROM l
    WHERE l.to_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
  )
  SELECT * FROM (SELECT * FROM outs UNION ALL SELECT * FROM ins) x
   WHERE x.union_id IS NOT NULL AND x.wallet_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM unions u WHERE u.id = x.union_id);
$$;

REVOKE ALL ON FUNCTION public.fn_union_treasury_legs(timestamptz, timestamptz) FROM public, anon, authenticated;

-- Last unlabeled union wallet out: 2026-10-02 10:04:20 UTC (verified
-- 2026-11-02 over 2026-10-01 .. now). Re-close Oct 1 and Oct 2 Chicago.
DELETE FROM public.ca_union_treasury_hours_done
 WHERE hour_start < timestamptz '2026-10-03 00:00 America/Chicago';

COMMIT;
