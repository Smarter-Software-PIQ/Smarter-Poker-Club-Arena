-- FIXTURE CLOCK (the one declared time stand-in). The weekly runner is gated on
-- the Monday wall clock (04:00 America/Chicago), preparation on the week having
-- closed, and every proof on its own age. The harness moves the whole
-- database's clock instead of editing any of those tests: now(),
-- transaction_timestamp(), statement_timestamp() and clock_timestamp() answer
-- the real instant plus rf.clock_offset, a database setting the harness
-- changes between cron ticks. Every production function, column default and
-- trigger therefore reads one consistent clock, unmodified. The SQL-standard
-- forms (CURRENT_DATE and friends) are not shifted; the harness asserts that no
-- loaded function that reads one of them was executed by the run.
CREATE FUNCTION pg_catalog.rf_real_clock() RETURNS timestamptz LANGUAGE internal VOLATILE PARALLEL SAFE AS 'clock_timestamp';
CREATE FUNCTION pg_catalog.rf_real_now() RETURNS timestamptz LANGUAGE internal STABLE PARALLEL SAFE AS 'now';
CREATE FUNCTION pg_catalog.rf_real_stmt() RETURNS timestamptz LANGUAGE internal STABLE PARALLEL SAFE AS 'statement_timestamp';
CREATE FUNCTION pg_catalog.rf_offset() RETURNS interval LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(pg_catalog.current_setting('rf.clock_offset',true),''),'0')::interval$$;
CREATE OR REPLACE FUNCTION pg_catalog.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT pg_catalog.rf_real_clock()+pg_catalog.rf_offset()$$;
CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT pg_catalog.rf_real_now()+pg_catalog.rf_offset()$$;
CREATE OR REPLACE FUNCTION pg_catalog.transaction_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT pg_catalog.rf_real_now()+pg_catalog.rf_offset()$$;
CREATE OR REPLACE FUNCTION pg_catalog.statement_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT pg_catalog.rf_real_stmt()+pg_catalog.rf_offset()$$;
