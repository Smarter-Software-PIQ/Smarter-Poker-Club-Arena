-- The union treasury log's wallet lookup uses its index (verification, 2026-11-02).
--
-- 20261102090856 named an unlabeled union wallet leg by the wallet that union
-- debited or credited in the same transaction, filtering union_wallet_
-- transactions on (union_id, created_at) only. The only index that reaches
-- those rows is (union_id, wallet, created_at), so without the wallet the
-- lookup walked the union's whole wallet history - millions of rake rows -
-- once per leg. Re-closing 2026-10-02 06:00 UTC (582 such legs) ran 104 s on
-- disk reads before it was cancelled and the 5-minute job was paused.
--
-- The same rule, asked the way the index answers it: each of the four wallet
-- names by equality, one index-only seek each (measured: 112 ms for that
-- whole hour; all 587 unlabeled legs of Oct 1-2 resolve to the Rake Treasury,
-- 886,610.25). Zero or several matches still resolve to nothing.
--
-- Oct 1 and Oct 2 Chicago are still open (cleared by 20261102090856 and not
-- yet re-closed), so the resumed job closes them on its next run.

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
          (SELECT CASE min(m.w) WHEN 'chip_balance' THEN 'union_bank'
                                   WHEN 'rake_wallet' THEN 'rake_treasury'
                                   WHEN 'promo_wallet' THEN 'promo'
                                   WHEN 'spin_reserve_wallet' THEN 'spins_treasury' END
             FROM unnest(ARRAY['chip_balance','rake_wallet','promo_wallet','spin_reserve_wallet']) AS m(w)
            WHERE EXISTS (SELECT 1 FROM union_wallet_transactions u
                           WHERE u.union_id = l.union_id AND u.wallet = m.w
                             AND u.created_at = l.created_at AND u.direction = 'debit')
           HAVING count(*) = 1)
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
          (SELECT CASE min(m.w) WHEN 'chip_balance' THEN 'union_bank'
                                   WHEN 'rake_wallet' THEN 'rake_treasury'
                                   WHEN 'promo_wallet' THEN 'promo'
                                   WHEN 'spin_reserve_wallet' THEN 'spins_treasury' END
             FROM unnest(ARRAY['chip_balance','rake_wallet','promo_wallet','spin_reserve_wallet']) AS m(w)
            WHERE EXISTS (SELECT 1 FROM union_wallet_transactions u
                           WHERE u.union_id = l.union_id AND u.wallet = m.w
                             AND u.created_at = l.created_at AND u.direction = 'credit')
           HAVING count(*) = 1)
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

-- periodic-work: the job builds the treasury log's hourly totals and itemized rows from the
-- ledger, which is the product itself; it was paused only while the lookup above was slow.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'ca-union-treasury-log-5m'), active := true);

COMMIT;
