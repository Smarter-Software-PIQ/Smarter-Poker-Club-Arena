# tests/card-back-prices-match-the-catalog.law.test.ts

Replaying every migration's `feature_pricing` writes leaves exactly the paid `CARD_BACK_CATALOG` card backs on sale, at the catalogue's prices, and the production storefront census counts that many. This keeps the server price list from selling a back the Table Studio cannot show (`card_back_dragon`/`card_back_galaxy`, alert 371597).
