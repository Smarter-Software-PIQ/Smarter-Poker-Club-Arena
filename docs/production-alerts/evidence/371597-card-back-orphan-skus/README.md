# 371597 item 4: storefront census expects 9 card backs, the Studio shows 7

Alert: `operational_alert_events` row 371597 (`club-arena.post-deploy-e2e`, critical).
Run 43210315096 on `7608c4721`, job 131156857551, `production-customization-commerce.spec.ts`:
"Cards did not expose every premium storefront SKU. Expected length: 9, Received length: 7"
(neon, diamond, gold, carbon, holographic, club-branded, diamond-foil).

## Root cause (read from production 2026-11-12, read-only)

- `CARD_BACK_CATALOG` (`src/components/table/CardImage.tsx`) has offered ten printed
  backs since #10308: 3 free and 7 paid, at the same prices `feature_pricing` holds for
  them.
- `feature_pricing` still holds two more paid rows, seeded by `20260829190000`:
  `card_back_dragon` = 125 and `card_back_galaxy` = 75. The client aliases them to
  `diamond` (100) and `neon` (75). No tile shows them.
- `fn_purchase_feature_v2` sells any `feature_pricing` row (`SELECT ... FROM
feature_pricing WHERE feature = p_feature`), so a direct call could charge 125
  diamonds for a back that renders as the 100-diamond `diamond` design.
- Nothing depends on either SKU: 0 `feature_purchases`, 0 `digital_purchase_receipts`,
  0 `theme_asset_unlocks`, 0 `user_theme_settings` rows, and no foreign key or trigger
  on `feature_pricing`.
- The spec pinned 9 card backs and 67 storefront SKUs. Production has 67 (9 card
  backs); the catalogue implies 65 (7).

## Fix

- Migration `20261112150007` retires the two orphan price rows. It asserts the rows
  as read and asserts 0 purchases, receipts and unlocks, so it aborts if anything
  changed. `cosmetic_catalog` is untouched.
- The spec census moves to 7 card backs and 65 SKUs.

The self-aborting production probe was not executed. The Supabase tool held it for an
interactive confirmation that no one answered. The figures above come from read-only
selects, and the migration re-asserts them at install.

## Hardening

- Regression law: `tests/card-back-prices-match-the-catalog.law.test.ts`. It replays
  every migration's `feature_pricing` writes and requires the live `card_back_*` set
  and prices to equal the paid `CARD_BACK_CATALOG`. It also requires the production
  census to count that many. Both cases fail on `origin/main` (`dragon: 125`,
  `galaxy: 75`; count 9) and pass with this change.
- Invariant: the price list and the catalogue cannot drift apart without CI failing.
- Detection: the Post-Deploy customization-commerce census, already routed to
  `operational_alert_events` with `target_task_id`.
- CI gate: `Client Unit Tests (vitest)`.
