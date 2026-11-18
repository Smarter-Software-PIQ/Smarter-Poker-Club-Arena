-- 20261112150007_retire_orphan_card_back_prices_dragon_galaxy.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Production Alerts row 371597 (Post-Deploy E2E, customization-commerce):
-- the Table Studio Cards tab sells 7 paid card backs (CARD_BACK_CATALOG in
-- src/components/table/CardImage.tsx, the ten printed decks since #10308),
-- but feature_pricing still carries the two aliases 20260829190000 seeded:
--
--   card_back_dragon  125  (client renders it as 'diamond', priced 100)
--   card_back_galaxy   75  (client renders it as 'neon',    priced 75)
--
-- fn_purchase_feature_v2 sells ANY feature_pricing row, so a direct call can
-- still charge 125 diamonds for a back the player already sees as the 100
-- diamond 'diamond' design. Neither SKU is reachable from the UI. Read from
-- production on 2026-11-12 before writing this file: 0 feature_purchases,
-- 0 digital_purchase_receipts, 0 theme_asset_unlocks and 0 user_theme_settings
-- reference either id, and nothing holds a foreign key to feature_pricing.
--
-- The two price rows are retired. Nobody owns them, so nothing is taken from
-- anyone and no settled record changes. cosmetic_catalog keeps its 'vip'
-- rows for both ids so any stored legacy alias still resolves for VIP holders.
-- The assertions abort the whole file if a purchase, receipt or unlock
-- appears before it installs, or if the rows no longer match what was read.
--
-- Not a hot table and no ACCESS EXCLUSIVE lock: ordinary install route.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.feature_pricing WHERE feature IN ('card_back_dragon', 'card_back_galaxy'))

BEGIN;

DO $$
DECLARE
  v_rows integer;
  v_owned integer;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.feature_pricing
   WHERE (feature = 'card_back_dragon' AND diamond_cost = 125 AND usage_type = 'permanent')
      OR (feature = 'card_back_galaxy' AND diamond_cost = 75 AND usage_type = 'permanent');
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'expected the two orphan card-back prices as read on 2026-11-12, found %', v_rows;
  END IF;

  SELECT (SELECT count(*) FROM public.feature_purchases
           WHERE feature IN ('card_back_dragon', 'card_back_galaxy'))
       + (SELECT count(*) FROM public.digital_purchase_receipts
           WHERE request_payload->>'feature' IN ('card_back_dragon', 'card_back_galaxy'))
       + (SELECT count(*) FROM public.theme_asset_unlocks
           WHERE category = 'cards_id' AND asset_id IN ('dragon', 'galaxy'))
    INTO v_owned;
  IF v_owned <> 0 THEN
    RAISE EXCEPTION 'orphan card-back SKUs now have % purchase, receipt or unlock rows; refusing to retire', v_owned;
  END IF;
END
$$;

DELETE FROM public.feature_pricing
 WHERE feature IN ('card_back_dragon', 'card_back_galaxy');

COMMIT;
