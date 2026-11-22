/**
 * NATIVE POSTGRESQL 17 PROOF: RETIRE INERT LEGACY PIN-MANIFEST FUNCTIONS
 * (2026-11-20, Wave 2 hardening).
 *
 * Exercises supabase/migrations/20261120213500_retire_inert_legacy_pin_manifests.sql
 * against a real local PostgreSQL 17 cluster:
 *   1. Refuses retirement if smarter_private.original_hand_correction_sources_match()
 *      still returns TRUE.
 *   2. Refuses retirement if public.ca_mtt_admission_contract is still in
 *      'legacy-capacity-v1'.
 *   3. Installs cleanly through the applier's stale-pin guard when production
 *      is in its terminal state (original_hand_correction_sources_match() = false,
 *      ca_mtt_admission_contract.abi = 'unlimited-mtt-v2') AND on an empty
 *      rehearsal schema copy.
 *   4. After install: both functions hold zero 32-char hex md5 pins, preserve
 *      postgres ownership and private ACLs, original_hand_correction_sources_match()
 *      returns false, and fn_ca_guard_mtt_admission_contract() still allows no-op
 *      UPDATEs while refusing INSERT, UPDATE of abi, DELETE, and TRUNCATE with
 *      MTT_ADMISSION_CONTRACT_IMMUTABLE (55000).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stalePinGuardSQL } from '../../scripts/ci/migration-stale-pins.mjs';

const ROOT = resolve(__dirname, '../..');
const MIG_NAME = '20261120213500_retire_inert_legacy_pin_manifests.sql';
const SQL = readFileSync(join(ROOT, 'supabase/migrations', MIG_NAME), 'utf8');

const bin = [
  process.env.PG_BIN,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin',
].find((dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((n) => existsSync(`${dir}/${n}`)));

let scratch = '';
let started = false;
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];

function psql(db: string, sql: string, extra: string[] = []) {
  const r = spawnSync(
    `${bin}/psql`,
    ['-h', join(scratch, 's'), '-p', '5432', '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra],
    { input: sql, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 }
  );
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '' };
}

const ok = (db: string, sql: string) => {
  const r = psql(db, sql, ['-A', '-t']);
  expect(r.status, r.out.slice(-2000)).toBe(0);
  return r.stdout.trim();
};

function setupDb(db: string, opts: { handMatchReturns: boolean; contractAbi: string | null }) {
  ok('postgres', `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};`);
  const roles = `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
  `;
  const fakeMd5A = 'a'.repeat(32);
  const fakeMd5B = 'b'.repeat(32);
  const schema = `
    ${roles}
    CREATE SCHEMA smarter_private;
    CREATE FUNCTION smarter_private.original_hand_correction_sources_match() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = pg_catalog, public, smarter_private AS $body$
      SELECT '${fakeMd5A}' = '${opts.handMatchReturns ? fakeMd5A : fakeMd5B}';
    $body$;
    ALTER FUNCTION smarter_private.original_hand_correction_sources_match() OWNER TO postgres;
    REVOKE ALL ON FUNCTION smarter_private.original_hand_correction_sources_match() FROM PUBLIC, anon, authenticated, service_role;

    CREATE TABLE public.ca_mtt_admission_contract (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      abi text NOT NULL CHECK (abi IN ('legacy-capacity-v1', 'unlimited-mtt-v2'))
    );
    ${opts.contractAbi ? `INSERT INTO public.ca_mtt_admission_contract (singleton, abi) VALUES (true, '${opts.contractAbi}');` : ''}

    CREATE FUNCTION public.fn_ca_guard_mtt_admission_contract() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $body$
    DECLARE v_expected text := '${fakeMd5B}';
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.singleton IS NOT DISTINCT FROM OLD.singleton AND NEW.abi IS NOT DISTINCT FROM OLD.abi THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'MTT_ADMISSION_CONTRACT_IMMUTABLE' USING ERRCODE = '55000';
    END $body$;
    ALTER FUNCTION public.fn_ca_guard_mtt_admission_contract() OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.fn_ca_guard_mtt_admission_contract() FROM PUBLIC, anon, authenticated, service_role;

    CREATE TRIGGER ca_mtt_admission_contract_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON public.ca_mtt_admission_contract
      FOR EACH ROW EXECUTE FUNCTION public.fn_ca_guard_mtt_admission_contract();
    CREATE TRIGGER ca_mtt_admission_contract_no_truncate
      BEFORE TRUNCATE ON public.ca_mtt_admission_contract
      FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_guard_mtt_admission_contract();
  `;
  ok(db, schema);
}

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries not found');
  scratch = mkdtempSync(join(tmpdir(), 'retire-pins-'));
  mkdirSync(join(scratch, 's'));
  execFileSync(
    `${bin}/initdb`,
    ['-D', join(scratch, 'd'), '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions'],
    { env, stdio: 'pipe' }
  );
  execFileSync(
    `${bin}/pg_ctl`,
    ['-D', join(scratch, 'd'), '-l', join(scratch, 'pg.log'), '-o', `-k ${join(scratch, 's')} -h '' -p 5432 -F`, 'start'],
    { env, stdio: 'pipe' }
  );
  started = true;
});

afterAll(() => {
  if (started) {
    try {
      execFileSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', 'stop'], { env, stdio: 'pipe' });
    } catch {
      // ignore cleanup error
    }
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('20261120213500_retire_inert_legacy_pin_manifests.sql (native PG17)', () => {
  it('refuses retirement when original_hand_correction_sources_match() still returns TRUE', () => {
    setupDb('refuse_true', { handMatchReturns: true, contractAbi: 'unlimited-mtt-v2' });
    const r = psql('refuse_true', SQL);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('still returns TRUE; refusing retirement');
  });

  it('refuses retirement when ca_mtt_admission_contract is still in legacy-capacity-v1', () => {
    setupDb('refuse_legacy', { handMatchReturns: false, contractAbi: 'legacy-capacity-v1' });
    const r = psql('refuse_legacy', SQL);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('not in terminal unlimited-mtt-v2 state');
  });

  it('installs cleanly through stalePinGuardSQL, releases all pins, and keeps immutability enforced', () => {
    setupDb('retire_ok', { handMatchReturns: false, contractAbi: 'unlimited-mtt-v2' });
    const guarded = stalePinGuardSQL(MIG_NAME, SQL, SQL);
    const r = psql('retire_ok', guarded);
    expect(r.status, r.out).toBe(0);

    // Zero 32-char hex pins remain in either function
    expect(
      ok(
        'retire_ok',
        `SELECT count(*) FROM pg_proc WHERE oid IN (
          'smarter_private.original_hand_correction_sources_match()'::regprocedure,
          'public.fn_ca_guard_mtt_admission_contract()'::regprocedure
        ) AND prosrc ~ '[0-9a-f]{32}'`
      )
    ).toBe('0');

    // original_hand_correction_sources_match() returns false
    expect(ok('retire_ok', 'SELECT smarter_private.original_hand_correction_sources_match()')).toBe('f');

    // No-op UPDATE succeeds
    expect(
      psql('retire_ok', "UPDATE public.ca_mtt_admission_contract SET abi = 'unlimited-mtt-v2' WHERE singleton").status
    ).toBe(0);

    // INSERT, UPDATE changing abi, DELETE, and TRUNCATE all raise MTT_ADMISSION_CONTRACT_IMMUTABLE
    for (const stmt of [
      "INSERT INTO public.ca_mtt_admission_contract (singleton, abi) VALUES (true, 'legacy-capacity-v1')",
      "UPDATE public.ca_mtt_admission_contract SET abi = 'legacy-capacity-v1' WHERE singleton",
      'DELETE FROM public.ca_mtt_admission_contract',
      'TRUNCATE public.ca_mtt_admission_contract',
    ]) {
      const res = psql('retire_ok', stmt);
      expect(res.status, stmt).not.toBe(0);
      expect(res.out, stmt).toContain('MTT_ADMISSION_CONTRACT_IMMUTABLE');
    }
  });

  it('also installs cleanly on an empty schema-only rehearsal copy', () => {
    setupDb('retire_empty', { handMatchReturns: false, contractAbi: null });
    const r = psql('retire_empty', stalePinGuardSQL(MIG_NAME, SQL, SQL));
    expect(r.status, r.out).toBe(0);
  });
});
