# tests/hot-path-buffer-budget-is-enforced.law.test.ts

Hot-path tournament and hand-settlement SQL and authoritative PL/pgSQL functions are guarded by scripts/ci/test-hot-path-buffer-budget.py on native PostgreSQL 17 with EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) upper bounds, zero Seq Scan on 5,000+ row history tables, negative self-tests, and CI wiring in .github/workflows/tournament-event-lane.yml.
