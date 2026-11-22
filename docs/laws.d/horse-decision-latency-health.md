# server/src/observability/HorseDecisionLatencyHealth.law.test.ts

Guarantees that per-worker >100 ms decision latency telemetry is wired read-only onto /health without affecting dealer routing readiness or decision computation, has zero runtime imports, and that scripts/ops/post-cutover-audit\*.mjs stays strictly read-only via linked Supabase CLI with zero .env reads.
