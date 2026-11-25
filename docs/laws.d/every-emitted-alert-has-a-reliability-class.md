# tests/every-emitted-alert-has-a-reliability-class.law.test.ts

Every alert emitted in `infra/monitoring/` Prometheus rules, `sp_daily_digest` / `fn_sp_critical_scan`, and Club Arena engine/SQL watches must resolve to an explicit non-`unclassified` class in `smarter_private.reliability_alert_classes` migrations, while preserving the global `priority = 1000` `unclassified` fallback and non-incident receipts.
