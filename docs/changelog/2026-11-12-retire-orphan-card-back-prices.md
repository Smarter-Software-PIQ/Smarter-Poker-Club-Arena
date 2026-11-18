# Retire the two card-back prices the Table Studio no longer sells

`feature_pricing` kept `card_back_dragon` (125) and `card_back_galaxy` (75) after #10308
cut the Studio to seven paid backs. No tile showed them, but the purchase RPC still sold
them. Migration `20261112150007` retires both rows (0 owners, asserted at install). The
production storefront census now expects 7 backs and 65 SKUs, and
`tests/card-back-prices-match-the-catalog.law.test.ts` keeps the price list equal to the
catalogue (alert 371597, item 4).
