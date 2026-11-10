"""Append the exact owner installer to the existing real Lightning fixture.

Unchanged financial owners are loaded, not executed, for source hash guards.
The actual generation algorithm uses synthetic fingerprints, never production
restoration data. The real Lightning chain above supplies financial behavior.
"""
import json

def build_sql(root):
    fixture = root / 'scripts/ci/fixtures'
    owners = json.loads((fixture / 'lightning-original-funding-owner-qualified-definitions.json').read_text())['owners']
    pre = json.loads((fixture / 'lightning-original-funding-owner-preimages.json').read_text())['owners']
    migration = root / 'supabase/migrations/20261110064744_original_lightning_results_follow_the_original_funding_owner.sql'
    sql = """
\\connect template1 postgres
CREATE DATABASE lightning_owner_qualified_native TEMPLATE postgres;
\\connect lightning_owner_qualified_native postgres
SET check_function_bodies=off;
-- The preceding real zero-payer fixture deliberately uses a text-valued
-- boundary control. Retire only that exact fixture stub, only in our clone;
-- the unchanged qualified catalog below installs the real timestamptz owner.
DO $boundary_stub$DECLARE p pg_proc%ROWTYPE;BEGIN
 IF current_database()<>'lightning_owner_qualified_native' THEN RAISE EXCEPTION 'owner_fixture_clone_required';END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.fn_active_maintenance_release_boundary()');
 IF FOUND AND p.prorettype<>'timestamptz'::regtype THEN
  IF p.prorettype<>'text'::regtype OR p.prosrc IS DISTINCT FROM 'SELECT NULL::text'
   OR p.prolang IS DISTINCT FROM(SELECT oid FROM pg_language WHERE lanname='sql') OR p.pronargs<>0 OR p.prosecdef OR p.provolatile<>'v'
  THEN RAISE EXCEPTION 'owner_fixture_boundary_stub_changed';END IF;
  DROP FUNCTION public.fn_active_maintenance_release_boundary();
 END IF;
END$boundary_stub$;
CREATE SCHEMA IF NOT EXISTS auth;
DO $auth$BEGIN IF to_regprocedure('auth.role()')IS NULL THEN EXECUTE $role$CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text'$role$;END IF;END$auth$;
CREATE TABLE IF NOT EXISTS public.engine_maintenance_break(enforce_freeze boolean,announced_at timestamptz,phase text,break_started_at timestamptz,break_ends_at timestamptz);
CREATE TABLE IF NOT EXISTS public.engine_maintenance_thaws(contract_version integer,release_target_at timestamptz,shifted jsonb);
CREATE TABLE IF NOT EXISTS smarter_private.original_inventory_restoration_cases(event_id bigint,family text,source_refs jsonb,original_witness jsonb);
CREATE TABLE IF NOT EXISTS smarter_private.original_inventory_restoration_certificates(event_id bigint,boundary timestamptz,witness_md5 text,proof_md5 text);
CREATE TABLE IF NOT EXISTS smarter_private.original_treasury_historical_admissions(ledger_id uuid,kind text,source_fingerprint text);
INSERT INTO smarter_private.original_inventory_restoration_cases SELECT n,'synthetic-source-guard','[]','{}'FROM generate_series(1,245)n;
INSERT INTO smarter_private.original_inventory_restoration_certificates SELECT n,'2026-10-12 07:00Z',md5(n::text),md5('synthetic:'||n)FROM generate_series(1,245)n;
"""
    sql += '\n'.join(x['definition'] + ';\nALTER FUNCTION '+x['signature']+' OWNER TO postgres;' for x in owners + pre)
    for row in pre:
        sql += '\nREVOKE ALL ON FUNCTION ' + row['signature'] + ' FROM PUBLIC,anon,authenticated,service_role;'
        if 'service_role=X/postgres' in (row['acl'] or ''):
            sql += '\nGRANT EXECUTE ON FUNCTION ' + row['signature'] + ' TO service_role;'
    sql += """
CREATE TABLE harness.owner_generation(before_value text);
INSERT INTO harness.owner_generation SELECT smarter_private.original_inventory_basis_generation();
DO $qualified$BEGIN IF smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true OR (SELECT before_value FROM harness.owner_generation)IS NULL THEN RAISE EXCEPTION 'actual68_generation_fixture_not_qualified';END IF;END$qualified$;
"""
    sql += '\n\\i ' + str(migration) + '\n'
    sql += """
DO $generation$BEGIN IF smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true OR smarter_private.original_inventory_basis_generation()IS NULL OR smarter_private.original_inventory_basis_generation()IS NOT DISTINCT FROM(SELECT before_value FROM harness.owner_generation)THEN RAISE EXCEPTION 'actual69_generation_did_not_change';END IF;END$generation$;
"""
    sql += '\n\\i ' + str(fixture / 'lightning-original-funding-owner-native.sql') + '\n'
    sql += "\n\\connect postgres postgres\nDROP DATABASE lightning_owner_qualified_native;\n"
    return sql
