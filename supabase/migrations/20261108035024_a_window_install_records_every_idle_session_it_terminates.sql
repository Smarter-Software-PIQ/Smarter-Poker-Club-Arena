-- 20261108035024_a_window_install_records_every_idle_session_it_terminates.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A daily-maintenance window migration gets ONE attempt with a 1 s
-- lock_timeout inside the confirmed 04:00 America/Chicago freeze. A single
-- session left "idle in transaction" holding a lock on the file's relation (an
-- abandoned psql, a management-API or CLI session) refuses that attempt, and
-- the file waits a full day for a holder that will never finish on its own.
--
-- Since this change, scripts/ci/install-window-migrations.mjs terminates
-- exactly those sessions immediately before a file's one attempt: only on the
-- relations the file declares with "-- @locks:", only sessions idle in
-- transaction for at least IDLE_HOLDER_MIN_IDLE_MS, only direct sessions of
-- the postgres role family (never superusers, Supabase internal roles,
-- pg_cron, PostgREST, background workers or the installer itself), and only
-- while the same statement confirms the daily freeze with its start reserve
-- (scripts/ci/maintenance-window-migrations.mjs IDLE_BLOCKERS_TERMINATE_QUERY).
-- This table is the durable record of every such termination, written by the
-- same statement that sends the signal, so a kill without a row cannot happen.
-- If this table is missing the statement fails and terminates nothing.
--
-- No foreign key: a record must never take a lock on a live table (CLAUDE.md
-- section 2 rule 7). Plain CREATE TABLE, no hot-table lock, so it installs
-- through the ordinary Apply Merged Migration route.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.ca_window_install_terminations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  terminated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  migration        text NOT NULL,
  pid              integer NOT NULL,
  session_role     text,
  application_name text,
  state            text NOT NULL,
  relation         text NOT NULL,
  lock_mode        text NOT NULL,
  waiting          boolean NOT NULL,
  xact_age         interval,
  idle_for         interval,
  terminated       boolean NOT NULL,
  query            text
);
COMMENT ON TABLE public.ca_window_install_terminations IS
  'Every idle-in-transaction session scripts/ci/install-window-migrations.mjs terminated inside the confirmed 04:00 America/Chicago freeze because it held a lock a declared window migration needed (2026-11-08).';
ALTER TABLE public.ca_window_install_terminations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_window_install_terminations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ca_window_install_terminations FROM service_role;
GRANT SELECT ON public.ca_window_install_terminations TO service_role;

COMMIT;
