# tests/guarantee-house-supplements-starts-from-adjustments.law.test.ts

`public.fn_ca_guarantee_house_supplements(uuid)` and `public.fn_ca_guarantee_funding(uuid)` stay `LANGUAGE plpgsql` (caching compiled SPIPlans once per session instead of re-planning 45+ `chip_ledger` indexes on every call), anchor supplements on `public.ca_manual_adjustments (tournament_id)` with an `IF NOT EXISTS` short-circuit backed by the partial CONCURRENTLY index `idx_ca_manual_adjustments_settled_player_wallet_tournament`, and evaluate supplements once per tournament (2026-11-22).
