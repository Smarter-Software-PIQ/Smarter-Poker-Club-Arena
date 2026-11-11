# Wheel quarter-game receipt compatibility

The client now understands contract 5, which assigns exactly 25% combined ordinary and Super earned-game probability to each paid spin. It selects the new paid endpoint only after an authoritative quote advertises contract 5; contract 2–4, welcome and daily spins retain their existing endpoint and receipt verification. This client release does not activate the new distribution.

The model retains the existing exclusion of the immediately previous prize. Upgrade retains 1% probability unless it is that excluded prize, and its conditional game chance remains 80%. Ordinary games therefore receive 24.2% (or 25% when Upgrade is excluded). Remaining non-game odds retain their relative weights with deterministic largest-remainder rounding. Diamond Cards do not count as an earned game. There is no streak counter or every-fourth guarantee.

Versioned HMAC domains and exact conditional weights are verified against isolated PostgreSQL receipts for all twelve outcomes and both Upgrade branches. Existing paid receipt replay identity remains unchanged. An old tab's new paid request after activation receives an explicit refresh message before any debit; the client surfaces that message. Payouts, floors and wallet limits are unchanged.

Validation: 17 predecessor contexts, PostgreSQL-generated HMAC receipts, pending-state reload, explicit endpoint selection, old-tab refusal and no endpoint downgrade. The separate database change additionally exercises actual draws, historical replay across installation and simultaneous full-wallet requests.
