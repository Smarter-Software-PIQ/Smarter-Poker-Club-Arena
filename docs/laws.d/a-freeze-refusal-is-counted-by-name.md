# tests/a-freeze-refusal-is-counted-by-name.law.test.ts

Dan, 2026-11-07: a real player refused by the maintenance freeze is counted by name. The client files the refusal as PLATFORM_FROZEN (not the shared P0001), fn_client_error_health counts it on freeze_refusals_10m and freeze_refusal_users_10m (horses and automated sessions excluded; migration 20261107210000), the collector renders poker_client_freeze_refusal_users_10m without risking the original client gauges, and the info alert PlayersRefusedDuringFreeze records it in the operational intake without paging anyone.
