# tests/operational-watches-never-bypass-owner-page-route.law.test.ts

Owner direction (2026-11-20 15:13 Chicago): never notify the owner when an operational issue clears or resolves — notify only on active problems. Enforced by `tests/operational-watches-never-bypass-owner-page-route.law.test.ts`: `zz_a_real_alert_reaches_the_owner` remains gated on `WHEN (NEW.status = 'firing')`, and no migration after `20261120034809` may call `fn_raise_notification` directly inside any `fn_ca_*_watch` function or emit a Cleared/Resolved/Recovered owner notification.
