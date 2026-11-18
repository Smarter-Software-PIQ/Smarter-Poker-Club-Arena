# Seventy-Five Percent Always Top Up

Owner November 10: replace the universal 1/2 horse between-hand refill choice with a 75% Auto Top Up cohort. Classic uses the existing game-wide seat allocation and persists the nearest whole-horse share, retaining the most existing choices; Lightning uses the same stable per-horse admission hash with a 75% threshold. The remaining horses retain discretionary add-ons. Other stakes retain their current policy.

Buy-in/rebuy maximums, wallets, idempotency keys, actual applied amounts and legal hand boundaries are unchanged. Existing funded intents are not replayed and no production rows are manually repaired. Existing live seats adopt the new allocation through the original hand-boundary path after the engine release.

Regression coverage includes cohort size and stability, old all-on seat flags, explicit off choices, Classic game-wide persisted allocation, Lightning exclusion before funding, exact cents, bounded wallet purchases and ordinary rebuy behavior.
