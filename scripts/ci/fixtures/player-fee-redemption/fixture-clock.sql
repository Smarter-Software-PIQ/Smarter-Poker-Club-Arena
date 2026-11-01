-- Only the private initdb fixture may anchor now(); never a connected database.
-- Replay the captured October 24/25 cutover before its seven-day window expires.
SELECT set_config('fee_fixture.expected_data_directory', :'fixture_data_directory', false);
DO $$
BEGIN
  IF current_user <> 'fee_test' OR current_database() <> 'postgres'
     OR inet_server_addr() IS NOT NULL
     OR current_setting('data_directory') <> current_setting('fee_fixture.expected_data_directory')
     OR current_setting('data_directory') !~ '/fee-redemption\.[^/]+/data$' THEN
    RAISE EXCEPTION 'clock anchoring requires the owned fee redemption fixture';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT '2026-10-25 12:00:00+00'::timestamptz $$;

DO $$ BEGIN ASSERT now() = timestamptz '2026-10-25 12:00:00+00', 'historical fixture clock not installed'; END $$;
