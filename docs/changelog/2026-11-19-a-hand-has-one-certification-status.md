# A hand has one certification status (2026-11-19)

`cash_hand_provenance_receipts.status` is not a hand's certification. Every
Lightning (pooled) hand reads `uncertified` there with issue
`original_dealt_manifest_missing` by design, and is certified instead by
`fn_lightning_original_pnl_proof` (a `union_pnl_cash_outcome_link_resolutions`
row with `roster_source = 'lightning_pool'` and proof status `proven`). On
2026-11-18 an agent read the raw column as "about 70% of cash hands lack
seating proof"; measured, every Lightning hand of the prior day was
pool-certified and every Classic hand of the next two hours was captured.

Read certification from `smarter_private.cash_hand_certification`
(migration `20261119052600`): one row per receipt with `certified`, `basis`
(`dealt_manifest`, `lightning_pool`, `explained_gap`, `uncertified`) and
`reason`. Only `uncertified` is a real gap. `explained_gap` is uncertified for
a recorded platform cause (`smarter_private.cash_hand_provenance_explained_gaps`).
Read-only, security_invoker, service_role only; no reader's certification logic
changed. Pinned by `tests/unit/aHandHasOneCertificationStatus.test.ts`.
