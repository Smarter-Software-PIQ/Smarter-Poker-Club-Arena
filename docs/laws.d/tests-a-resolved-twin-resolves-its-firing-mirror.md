# tests/a-resolved-twin-resolves-its-firing-mirror.law.test.ts

The newest migration that rewrites fn_operational_alert_resolved_twin_closes_firing must set the earlier firing mirror rows (financial-alerts-backfill/-updates, drift-incidents-backfill/-updates) of the same original alert to status 'resolved' when its resolved twin arrives (2026-11-24). Until then the rule only re-labelled investigation_status, so about 100,700 financial-alerts-backfill rows stayed firing for alerts long resolved; the law fails on that earlier rule.
