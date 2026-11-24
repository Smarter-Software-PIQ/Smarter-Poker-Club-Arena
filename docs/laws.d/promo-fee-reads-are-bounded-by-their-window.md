# tests/promo-fee-reads-are-bounded-by-their-window.law.test.ts

The newest fn_ca_promo_fee_events bounds every rake_attributions read by a lower created_at, so per-hand promo triggers cost what the window holds, not a member's whole history.
