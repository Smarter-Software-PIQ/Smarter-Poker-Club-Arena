# tests/orphaned-checks-and-sms-registry-scrub.law.test.ts

Migration 20261125163000 (2026-11-25): `fn_ca_orphaned_checks()` excludes non-Club-Arena Trivia/PNM RPC prefixes and `p_session_id` helpers while keeping Club Arena sweep monitoring intact, `fn_ca_orphaned_checks_watch()` closes both `ca_drift_incidents` and its `financial_alerts` mirror on zero orphans, `fn_sms_scrub_number()` and BEFORE triggers cover all Commander and `newsletter_subscribers` SMS registries, and `fn_sms_filter_suppressed_phones(text[])` is `service_role`-only.
