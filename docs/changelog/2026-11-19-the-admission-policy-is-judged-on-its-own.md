# The admission policy is judged on its own (incident 3aabeee7)

**Alert:** HorseFleetThroughputPolicyUnknown, CRITICAL, 2026-11-19 23:06:49 CST; cleared by 23:20.

**What happened.** From 23:02 to 23:17, sixteen collector runs in a row failed with `PostgREST error: canceling statement due to statement timeout` on fn_monitoring_health_snapshot (8 s service_role budget; normally 1 to 1.6 s). The database was loaded in that window (ca-promo-profit-hourly-sweep runs averaging 72 s with two 120 s timeouts, plus ca-stats-witness-audit-15m at 109 s). The collector `die`d before writing anything, the money snapshot timestamp aged past 180 s, and sp:lightning_admission_policy:readable, which used that timestamp as the policy's freshness, went to 0.

**Root cause.** The alarm's own fact was never false: fn_lightning_admission_policy is catalog-only and answered throughout. The collector was all-or-nothing and the policy borrowed the money snapshot's clock, so any snapshot timeout paged as "policy cannot be read". fa23c973 (2026-11-14) was the same shape.

**Fix.** collect-monitoring-health.sh reads the policy first and writes it atomically to its own textfile, club_arena_admission_policy.prom, with its own poker_lightning_admission_policy_collected_timestamp_seconds. The readable rule judges that timestamp. A failed snapshot still fails closed and leaves the money file untouched, so MoneyHealthBlind and its siblings keep owning snapshot staleness. A stale policy reading still pages.

**Law:** tests/the-admission-policy-is-judged-on-its-own.law.test.ts, plus promtool cases in tests/monitoring/fleet-relative-throughput.test.yml.
