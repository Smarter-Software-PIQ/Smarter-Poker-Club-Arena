-- 20261119052600_a_hand_has_one_certification_status.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A cash hand's raw cash_hand_provenance_receipts.status is NOT its
-- certification. Every Lightning (pooled) hand reads 'uncertified' with issue
-- original_dealt_manifest_missing by design: a Lightning player holds a pool
-- reservation, not a physical chair, so no dealt-seat manifest can exist. Those
-- hands are certified instead by fn_lightning_original_pnl_proof, recorded in
-- union_pnl_cash_outcome_link_resolutions with roster_source 'lightning_pool'
-- and proof status 'proven' (since 20261019194126). On 2026-11-18 an agent read
-- the raw column as "about 70% of cash hands have no seating proof"; measured,
-- 42,308 of 42,308 Lightning hands in the prior day were pool-certified and
-- every Classic hand in the following two hours was captured.
--
-- smarter_private.cash_hand_certification gives one answer per hand:
--   dealt_manifest  receipt captured (Classic, dealt-seat proof)
--   lightning_pool  a proven Lightning pool-custody resolution exists
--   explained_gap   uncertified for a known platform cause recorded in
--                   smarter_private.cash_hand_provenance_explained_gaps
--   uncertified     none of the above: a real gap
-- certified is true only for the first two. It is read-only, runs as the
-- caller (security_invoker) and is granted to service_role alone. It changes
-- no reader's certification logic.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE VIEW smarter_private.cash_hand_certification
WITH (security_invoker = true) AS
SELECT p.table_id,
       p.hand_number,
       p.hand_id,
       p.accepted_at,
       CASE WHEN p.status = 'captured' THEN 'dealt_manifest'
            WHEN r.table_id IS NOT NULL THEN 'lightning_pool'
            WHEN g.table_id IS NOT NULL THEN 'explained_gap'
            ELSE 'uncertified' END AS basis,
       (p.status = 'captured' OR r.table_id IS NOT NULL) AS certified,
       CASE WHEN p.status = 'captured' OR r.table_id IS NOT NULL THEN NULL
            WHEN g.table_id IS NOT NULL THEN g.cause
            ELSE p.issues::text END AS reason
  FROM public.cash_hand_provenance_receipts p
  LEFT JOIN LATERAL (
        SELECT x.table_id
          FROM public.union_pnl_cash_outcome_link_resolutions x
         WHERE x.table_id = p.table_id
           AND x.hand_number = p.hand_number
           AND x.roster_source = 'lightning_pool'
           AND x.proof->>'status' = 'proven'
         LIMIT 1) r ON true
  LEFT JOIN smarter_private.cash_hand_provenance_explained_gaps g
         ON g.table_id = p.table_id AND g.hand_number = p.hand_number;

COMMENT ON VIEW smarter_private.cash_hand_certification IS
  'One certification answer per cash hand. Raw cash_hand_provenance_receipts.status is not certification: Lightning hands read uncertified there and are certified by their proven lightning_pool resolution.';

REVOKE ALL ON smarter_private.cash_hand_certification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON smarter_private.cash_hand_certification TO service_role;

COMMIT;
