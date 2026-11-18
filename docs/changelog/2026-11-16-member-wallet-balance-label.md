# Member Wallet Balance Label

The simple member roster now prints `Wallet Balance` before the player wallet amount, distinguishing it from Fees This Week and Today win/loss. The existing amount formatter, financial permissions and update subscription are preserved.

A read-only production comparison on Monday November 16 confirmed that the installed period reader starts the week on Monday, rather than using a trailing seven-day range. Today/week fees matched for WooWoo (298.92), KingFish (325.74), and Burls (9.64); the same reader over the past seven dates returned 1,330.99, 1,539.30, and 162.17 respectively. No financial writer or fee calculation changed.

The existing simple roster regression requires the visible wallet label and full decimal amount. The existing isolated period-fee test covers the exact Monday start and exclusion of earlier fees.
