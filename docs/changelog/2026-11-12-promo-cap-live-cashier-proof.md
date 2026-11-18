# Promo cap live Cashier verification

The post-deploy Cashier contract still pinned the pre-cap promo body after #10577 installed the shared 50-chip rolling seven-day limit. It now requires the exact installed migration bytes and the capped function body, with the existing ACL, owner and search-path assertions unchanged. Native PostgreSQL qualification also asserts that the browser contract pins the body it actually executed.

The existing scoped Cashier workflow now verifies this database contract and includes the existing authenticated promo-wallet routing case alongside history and credit. Its two-origin client bracket includes all three promo UI consumers, and its original reserved zero-balance account cleanup remains mandatory. It moves no chips and does not claim a live money-bearing role matrix; native transaction/concurrency cases and the installed source binding provide that separate evidence.
