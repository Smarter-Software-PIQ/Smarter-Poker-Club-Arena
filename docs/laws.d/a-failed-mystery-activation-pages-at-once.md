# tests/a-failed-mystery-activation-pages-at-once.law.test.ts

An unexpected database error in fn_mystery_bounty_seed rolls the seed back, files one critical
financial_alerts row for that tournament (fn_ca_tournament_mystery_activation_failed) the first
time it happens, and is closed by the seed's own success path; transient refusals are re-raised
for the engine to retry (20261115015453, after the 2026-11-14 42883 stall).
