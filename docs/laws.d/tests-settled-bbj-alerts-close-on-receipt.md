# tests/settled-bbj-alerts-close-on-receipt.law.test.ts

`smarter_private.financial_alerts_proven_over(boolean, integer)` closes `processBBJPayout.exhausted` and `FeeReconciler.exhausted` (`kind = 'bbj_payout'`) alerts with a `verified:` resolution only when `public.bbj_payouts` exists for `(table_id, hand_number)` with `total_amount > 0`, `bbj_payout_recipients` plus unpaid `bbj_unclaimed_shares` equals `total_amount`, and no unresolved `pending_fee_distributions` (`kind = 'bbj_payout'`) row remains, while keeping EXECUTE revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
