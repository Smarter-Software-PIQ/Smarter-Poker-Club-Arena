-- 20261110004413_platform_alerts_go_to_one_owner_account.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: public.fn_is_platform_alert_recipient('47965354-0e56-43ef-931c-ddaab82af765'::uuid) AND NOT public.fn_is_platform_alert_recipient('3bb71bfe-f723-427c-aac7-a853ba04a014'::uuid)
--
-- PLATFORM ALERTS GO TO ONE OWNER ACCOUNT
--
-- Owner, 2026-11-09: "My instruction is one recipient for important
-- operational information: daniel@bekavactrading.com. Other admin or god
-- accounts must not become required recipients simply because of their role.
-- Preserve everyone's normal personal, security and gameplay notifications."
--
-- WHAT WAS WRONG. World Hub migration 20261012152000 (owner request
-- 2026-10-12, "Daniel's two accounts") made public.fn_is_platform_alert_recipient
-- true for 47965354 (kingfish, daniel@bekavactrading.com) AND 3bb71bfe
-- (mason, danbek4545@gmail.com). Both delivery guards that read it,
-- fn_notification_delivery_guard and fn_platform_push_recipient_guard, so still
-- let platform operational alerts reach the second account.
--
-- THE FIX. The recipient set is exactly one account, verified by id AND email
-- before anything changes. Only the recipient predicate is replaced; both
-- guards, the alert classifier and every non-platform notification are
-- untouched, so personal, security and gameplay notifications keep their
-- recipients. World Hub's deliveryPolicy PLATFORM_ALERT_RECIPIENTS mirrors it.
--
-- ROLLBACK: CREATE OR REPLACE the function with the two-uuid IN list from
-- 20261012152000. No rows are written; nothing to restore.
--
-- No money moves in this migration.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF to_regprocedure('public.fn_is_platform_alert_recipient(uuid)') IS NULL THEN
    RAISE EXCEPTION 'fn_is_platform_alert_recipient is missing; the delivery policy is not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users
                  WHERE id = '47965354-0e56-43ef-931c-ddaab82af765'::uuid
                    AND lower(email) = 'daniel@bekavactrading.com') THEN
    RAISE EXCEPTION 'the platform alert account does not match daniel@bekavactrading.com';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_is_platform_alert_recipient(p_user uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(p_user = '47965354-0e56-43ef-931c-ddaab82af765'::uuid, false);
$$;

DO $$ BEGIN
  IF NOT public.fn_is_platform_alert_recipient('47965354-0e56-43ef-931c-ddaab82af765'::uuid)
     OR public.fn_is_platform_alert_recipient('3bb71bfe-f723-427c-aac7-a853ba04a014'::uuid)
     OR public.fn_is_platform_alert_recipient(NULL) THEN
    RAISE EXCEPTION 'platform alert recipient set is not exactly the owner account';
  END IF;
END $$;

COMMIT;
