-- 20261110215108_the_kings_club_downline_snapshot_table_grants_only_what_it_n.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE KINGS CLUB DOWNLINE SNAPSHOT TABLE GRANTS ONLY WHAT IT NEEDS
-- ============================================================================
--
-- WHY. public.kings_club_downline_repair_20261108 was created on 2026-11-09 by
-- migration 20261109040704, which was applied to production and never
-- committed to this repo. Because it never went through a pull request, the
-- explicit-table-access law never judged it, and it was created with Supabase's
-- default table grants. Read from production 2026-11-10 (read-only):
--
--   relrowsecurity = true, policies = 0, rows = 10
--   grants: anon SELECT/INSERT/UPDATE/DELETE,
--           authenticated SELECT/INSERT/UPDATE/DELETE,
--           service_role SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE
--
-- Row level security is on with no policies, so anon and authenticated are
-- already denied every row in practice and no data was reachable. The table
-- grants are still real, still wrong, and still what the law asks about. This
-- closes them at the source instead of writing an exception for them: the
-- recording of 20261109040704 is filed separately and
-- scripts/ci/recorded-migrations.manifest.json requires that a finding still
-- true of production be fixed in production first, not settled in the record.
--
-- WHAT THIS CHANGES. Table-level and sequence-level privileges only. No row is
-- read, written or deleted; the 2026-11-08 reattachment snapshot it holds is
-- left exactly as it is, and the repair itself is neither re-run nor reversed.
-- Row level security is already enabled and stays enabled with no policies, so
-- the table remains reachable only by a role that bypasses RLS. service_role is
-- the server identity that wrote the snapshot and keeps the four data
-- operations it actually used; REFERENCES, TRIGGER and TRUNCATE are withdrawn
-- because nothing uses them on a closed one-off snapshot.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'kings_club_downline_repair_20261108' AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AND has_table_privilege('service_role', 'public.kings_club_downline_repair_20261108', 'SELECT') AND has_table_privilege('service_role', 'public.kings_club_downline_repair_20261108', 'INSERT') AND NOT has_table_privilege('service_role', 'public.kings_club_downline_repair_20261108', 'TRUNCATE') AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'kings_club_downline_repair_20261108')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

DO $exists$
BEGIN
  IF to_regclass('public.kings_club_downline_repair_20261108') IS NULL THEN
    RAISE EXCEPTION 'KINGS_CLUB_DOWNLINE_SNAPSHOT_MISSING: public.kings_club_downline_repair_20261108 is not in this database';
  END IF;
END
$exists$;

-- Row level security is already on (read 2026-11-10); assert it rather than
-- assume it, because the deny-all default is what protects the rows.
ALTER TABLE public.kings_club_downline_repair_20261108 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kings_club_downline_repair_20261108 FROM PUBLIC;
REVOKE ALL ON TABLE public.kings_club_downline_repair_20261108 FROM anon;
REVOKE ALL ON TABLE public.kings_club_downline_repair_20261108 FROM authenticated;
REVOKE ALL ON TABLE public.kings_club_downline_repair_20261108 FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kings_club_downline_repair_20261108 TO service_role;

-- The bigserial's sequence carries its own grants.
DO $seq$
DECLARE
  v_seq text := pg_get_serial_sequence('public.kings_club_downline_repair_20261108', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', v_seq);
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', v_seq);
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', v_seq);
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM service_role', v_seq);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END
$seq$;

COMMIT;
