# server/src/services/horsesBuyInForTableMaximum.law.test.ts

Owner October 26, 2026: horses always select the table maximum for cash buy-ins and rebuys; funding eligibility and session stop-loss still apply, so an unaffordable maximum is declined rather than reduced.

Owner October 31, 2026: every 1/2 cash horse selects the legal table maximum for buy-in, rebuy and each between-hand refill. This stake-specific order replaces the earlier discretionary refill habit, sliver threshold, bankroll reserve, exposure and stop-loss preferences at 1/2 only. Purchases still require actual available funds and the ordinary atomic/idempotent wallet path; no table maximum or live-hand boundary is bypassed. Other stakes retain the original policy.

Owner November 10, 2026: only 75% of 1/2 horses always top up after a hand. This supersedes the universal between-hand refill choice above. Classic keeps the nearest whole-horse 75% cohort using the existing seat flags and minimum changes; Lightning uses the same stable admission hash at 75%. The remaining horses retain ordinary discretionary add-ons and existing rebuy behavior. Buy-in/rebuy maximums, actual funds, hand boundaries and atomic/idempotent funding remain unchanged.
