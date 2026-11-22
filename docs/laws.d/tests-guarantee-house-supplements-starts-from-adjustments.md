# tests/guarantee-house-supplements-starts-from-adjustments.law.test.ts

`public.fn_ca_guarantee_house_supplements(uuid)` anchors its query on `public.ca_manual_adjustments (tournament_id)` via a materialized CTE backed by the partial CONCURRENTLY index `idx_ca_manual_adjustments_settled_player_wallet_tournament`, and `public.fn_ca_guarantee_funding(uuid)` evaluates it once per tournament so `ca-free-buy-funding-watch-15m` and `ca-guarantee-funding-variance-15m` never scan `chip_ledger` across every guaranteed event and hit their statement timeouts (2026-11-22).
