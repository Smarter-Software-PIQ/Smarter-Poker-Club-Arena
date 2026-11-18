# tests/the-place-evidence-guard-uses-the-key-index.law.test.ts

The wallet-credit place-evidence guard in fn_settle_tournament_places bounds its per-obligation LIKE join by the tournament key prefix on wallet_credit_idempotency_key_pattern_idx, so a large field settles inside the terminal statement budget, and no later migration may rewrite the function with the unbounded join.
