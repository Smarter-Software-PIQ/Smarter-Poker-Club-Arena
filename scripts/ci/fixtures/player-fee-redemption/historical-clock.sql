-- Only the disposable fee_test cluster. The exact October 25 cutover compares
-- a trailing seven-day hand window with historical daily cron rows. Replaying
-- it against today's clock makes the old daily row outlive its individual
-- hands for part of October 31, unrelated to the change under qualification.
-- Keep every production SQL byte and assertion intact; control the fixture's
-- clock instead. The runner captures and restores the original definition
-- before the later calendar contracts execute.
DO $$ BEGIN
  ASSERT current_user = 'fee_test' AND current_setting('listen_addresses') = '',
    'historical clock requires the isolated fee_test socket-only cluster';
END $$;
CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT '2026-10-26 12:00:00+00'::timestamptz $$;
DO $$ BEGIN
  ASSERT now() = '2026-10-26 12:00:00+00'::timestamptz,
    'historical cutover clock was not installed';
END $$;
