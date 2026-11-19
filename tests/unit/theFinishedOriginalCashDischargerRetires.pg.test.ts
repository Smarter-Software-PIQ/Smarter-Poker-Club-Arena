/**
 * THE FINISHED ORIGINAL CASH DISCHARGER RETIRES AND RELEASES ITS MONEY PINS
 * (2026-11-18, incident 075013fd lane Q).
 *
 * Native PostgreSQL proof for 20261118155910. The writer's live preimage is
 * rebuilt from its own migrations (origin 20261012224150 plus the getter-pin
 * move of 20261014225815) and must hash to production's 9e6fcbf6...; the
 * inventory source authority is production's byte-exact text (3d3c9886...,
 * scripts/ci/fixtures/original-cash-discharger-retirement). The migration is
 * installed through the applier's own stale-pin guard.
 *
 * Proves:
 *  - the preimage refuses EVERY call, even the replay of an existing
 *    certificate, once a money body it pins moves (what production does today);
 *  - the retired writer replays every certificate exactly as before, refuses
 *    anything else, and its answer no longer depends on any money body;
 *  - it is STABLE: PostgreSQL refuses a write inside it;
 *  - the migration refuses itself on a changed preimage, an incomplete
 *    discharge set, a non-discharged receipt or a false source authority;
 *  - without the source-authority pin move the applier's guard refuses it;
 *  - on production's exact authority text the move hits exactly one pin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stalePinGuardSQL } from '../../scripts/ci/migration-stale-pins.mjs';

const ROOT = process.cwd();
const MIGRATION =
  'supabase/migrations/20261118155910_the_finished_original_cash_discharger_retires_and_releases_i.sql';
const SQL = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
const ORIGIN = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20261012224150_original_retirement_evidence_certifies_finite_inventory_boun.sql'
  ),
  'utf8'
);
const PROD_SOURCES_MATCH = readFileSync(
  resolve(
    ROOT,
    'scripts/ci/fixtures/original-cash-discharger-retirement/sources-match-production.sql'
  ),
  'utf8'
);

const PRE_DEF = '9e6fcbf606004b81353a7704b50f072f';
const PRE_SRC = 'b7e407e4754fa326d1aba21e60e1d67b';
const POST_SRC = '627ec207046e9a9ac75c58dc93a21877';
const POST_DEF = 'f104a8a1b56061b7c638eeee04f253a2';
const PROD_SM = '3d3c9886b8389c06f357bdeee1a702f2';
const W = 'smarter_private.original_erased_cash_base_discharge(bigint,text)';

const EVENTS: Array<[number, string]> = [
  [42309154, 'dcc2248b35d55e8c3239044f5e5e2869'],
  [42346932, '4a806deeace376da57411d584cc90491'],
  [42399949, '2d6149ab417c6ade798d2aae7a7f7af1'],
  [42407664, '6463819644005aba4cc1817b20f9f21d'],
  [42586570, 'ca1904c2f019f5ec7864b113c2119db6'],
  [42607253, 'd4e0d142973bc8f8226ece46950e13c0'],
  [42626673, '503edc03d357862da655c3867b51240c'],
];

function slice(src: string, start: RegExp, end: RegExp): string {
  const i = src.search(start);
  if (i < 0) throw new Error(`anchor ${start} not found`);
  const rest = src.slice(i);
  const m = rest.match(end);
  if (!m || m.index === undefined) throw new Error(`end ${end} not found`);
  return rest.slice(0, m.index + m[0].length);
}
const WRITER_ORIGIN = slice(
  ORIGIN,
  /^CREATE OR REPLACE FUNCTION smarter_private\.original_erased_cash_base_discharge\(e bigint,h text\)$/m,
  /^END\$b\$;$/m
);
const EXPECTED_HASH = slice(
  ORIGIN,
  /^CREATE FUNCTION smarter_private\.original_erased_cash_base_expected_hash\(e bigint\)$/m,
  /^\$b\$;$/m
);

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

function psql(sql: string, db = 'postgres') {
  return spawnSync(
    `${bin}/psql`,
    [
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      join(scratch, 's'),
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      db,
    ],
    { input: sql, encoding: 'utf8', env }
  );
}
function q(sql: string, db: string) {
  const r = psql(sql, db);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
const install = (db: string, src = SQL) => psql(stalePinGuardSQL(MIGRATION, src, src), db);

// The fixture: production's discharge contract with a receipt reader that
// honours the certificate (the real reader re-verifies six immutable financial
// rows; that it says 'discharged' for all seven was read on production).
function fixture(db: string) {
  q(`CREATE DATABASE ${db}`, 'postgres');
  q(
    `CREATE SCHEMA smarter_private;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END$$;
CREATE TABLE smarter_private.original_inventory_restoration_cases(event_id bigint PRIMARY KEY, family text NOT NULL);
CREATE TABLE smarter_private.original_erased_cash_base_discharges(event_id bigint PRIMARY KEY, witness_md5 text NOT NULL);
CREATE FUNCTION smarter_private.original_erased_cash_base_discharge_immutable() RETURNS trigger LANGUAGE plpgsql AS $b$
BEGIN RAISE EXCEPTION 'original_cash_discharge_is_immutable' USING ERRCODE='55000';END$b$;
CREATE TRIGGER original_cash_discharge_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON smarter_private.original_erased_cash_base_discharges FOR EACH STATEMENT
 EXECUTE FUNCTION smarter_private.original_erased_cash_base_discharge_immutable();
${EXPECTED_HASH}
CREATE FUNCTION smarter_private.original_erased_cash_base_discharge_receipt(e bigint,h text)
RETURNS jsonb LANGUAGE sql STABLE AS $b$
 SELECT CASE WHEN d.event_id IS NULL THEN jsonb_build_object('status','pending','event_id',e)
  ELSE jsonb_build_object('status','discharged','event_id',e,'witness_md5',h,'custody','canonical_deleted_account_bank') END
 FROM (SELECT e) x LEFT JOIN smarter_private.original_erased_cash_base_discharges d ON d.event_id=e AND d.witness_md5=h
$b$;
-- One pinned money body: the one that moved twice today.
CREATE FUNCTION public.fn_ca_tally_balance_move() RETURNS trigger LANGUAGE plpgsql AS $b$BEGIN RETURN NEW;END$b$;
INSERT INTO smarter_private.original_inventory_restoration_cases
 SELECT x, 'erased_cash_receivable' FROM unnest(ARRAY[${EVENTS.map((e) => e[0]).join(',')}]::bigint[]) x;
INSERT INTO smarter_private.original_inventory_restoration_cases VALUES (1,'closed_player');
INSERT INTO smarter_private.original_erased_cash_base_discharges
 SELECT e, smarter_private.original_erased_cash_base_expected_hash(e) FROM unnest(ARRAY[${EVENTS.map((e) => e[0]).join(',')}]::bigint[]) e;
${WRITER_ORIGIN}
DO $$DECLARE d text:=pg_get_functiondef('${W}'::regprocedure);
BEGIN EXECUTE replace(d,'1411d22a7ad914a80922aeed8bfcf7e6','81fba77f13564999931e8a7a47cbd609'); END$$;
ALTER FUNCTION smarter_private.original_erased_cash_base_discharge(bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION smarter_private.original_erased_cash_base_discharge(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
-- The inventory source authority, in production's exact form, reduced to
-- the functions this fixture has: the writer and the two it reads.
DO $do$DECLARE v text:='';r record;BEGIN
 FOR r IN SELECT s FROM unnest(ARRAY['smarter_private.original_erased_cash_base_expected_hash(bigint)','smarter_private.original_erased_cash_base_discharge_receipt(bigint,text)','${W}']) s LOOP
  v:=v||CASE WHEN v='' THEN '' ELSE ',' END||format('(%L,%L)',r.s,md5(pg_get_functiondef(r.s::regprocedure)));
 END LOOP;
 EXECUTE $f$CREATE FUNCTION smarter_private.original_inventory_proof_sources_match()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $s$
 SELECT count(*)=3 AND bool_and(p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND md5(pg_get_functiondef(p.oid)) IS NOT DISTINCT FROM x.body_md5)
 FROM(VALUES $f$||v||$f$)x(signature,body_md5) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
$s$$f$;
END$do$;
REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;`,
    db
  );
}
// The preimage's money-pin loop, run alone (its other checks need the whole
// 245-case inventory): the 46 pins with fn_ca_tally_balance_move at b7911a24.
const PIN_LOOP = slice(WRITER_ORIGIN, /^ FOR pin IN SELECT \* FROM \(VALUES$/m, /^ END LOOP;$/m);

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the discharger retirement proof');
  scratch = mkdtempSync(join(tmpdir(), 'dischg-'));
  execFileSync(
    `${bin}/initdb`,
    ['-D', join(scratch, 'd'), '-U', 'postgres', '-A', 'trust', '--no-locale'],
    {
      env,
      stdio: 'pipe',
    }
  );
  execFileSync('mkdir', [join(scratch, 's')]);
  execFileSync(
    `${bin}/pg_ctl`,
    [
      '-D',
      join(scratch, 'd'),
      '-l',
      join(scratch, 'log'),
      '-o',
      `-k ${join(scratch, 's')} -p 5432 -c listen_addresses=`,
      '-w',
      'start',
    ],
    { env, stdio: 'pipe' }
  );
  started = true;
}, 60_000);
afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the finished original cash discharger retires and releases its money pins', () => {
  it('rebuilds production preimages byte-exact', () => {
    fixture('pre');
    expect(q(`SELECT md5(pg_get_functiondef('${W}'::regprocedure))`, 'pre')).toBe(PRE_DEF);
    expect(q(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${W}'::regprocedure`, 'pre')).toBe(
      PRE_SRC
    );
    q(PROD_SOURCES_MATCH, 'pre');
    expect(
      q(
        `SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))`,
        'pre'
      )
    ).toBe(PROD_SM);
  });

  it('on production text the pin move hits exactly one pin and nothing else', () => {
    const pin = `('${W}','${PRE_DEF}')`;
    expect(PROD_SOURCES_MATCH.split(pin)).toHaveLength(2);
    expect(PROD_SOURCES_MATCH.split(PRE_DEF)).toHaveLength(2);
    // The move only replaces the md5 inside that one pair.
    const moved = PROD_SOURCES_MATCH.replace(pin, `('${W}','${POST_DEF}')`);
    expect(moved.length).toBe(PROD_SOURCES_MATCH.length);
    expect(moved).toContain('count(*)=69');
  });

  it('the preimage refuses every call once one pinned money body moves, replay included', () => {
    fixture('stale');
    // The pin loop, alone: any pinned body that is absent or moved (here every
    // one the fixture lacks, and fn_ca_tally_balance_move, which is not
    // b7911a24) refuses before the writer reaches its replay branch.
    const r = psql(`DO $t$DECLARE pin record;BEGIN\n${PIN_LOOP}\nEND$t$;`, 'stale');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/original_cash_discharge_money_source_changed|does not exist/);
  });

  it('installs through the applier guard, keeps the authority true and replays every certificate', () => {
    fixture('ok');
    expect(q('SELECT smarter_private.original_inventory_proof_sources_match()', 'ok')).toBe('t');
    const r = install('ok');
    expect(r.status, r.stderr).toBe(0);
    expect(
      q(
        `SELECT md5(prosrc)||' '||provolatile::text||' '||prosecdef::text FROM pg_proc WHERE oid='${W}'::regprocedure`,
        'ok'
      )
    ).toBe(`${POST_SRC} s false`);
    expect(q(`SELECT md5(pg_get_functiondef('${W}'::regprocedure))`, 'ok')).toBe(POST_DEF);
    expect(q(`SELECT proacl::text FROM pg_proc WHERE oid='${W}'::regprocedure`, 'ok')).toBe(
      '{postgres=X/postgres}'
    );
    expect(q('SELECT smarter_private.original_inventory_proof_sources_match()', 'ok')).toBe('t');
    expect(q(`SELECT count(*) FROM pg_proc WHERE strpos(prosrc,'${PRE_DEF}')>0`, 'ok')).toBe('0');
    expect(q(`SELECT count(*) FROM pg_proc WHERE strpos(prosrc,'${POST_DEF}')>0`, 'ok')).toBe('1');
    for (const [e, h] of EVENTS) {
      const out = JSON.parse(
        q(`SELECT smarter_private.original_erased_cash_base_discharge(${e},'${h}')`, 'ok')
      );
      expect(out).toMatchObject({
        status: 'discharged',
        event_id: e,
        replayed: true,
        financial_payment: false,
      });
    }
  });

  it('its answer no longer depends on any money body', () => {
    const [e, h] = EVENTS[6];
    const before = q(
      `SELECT smarter_private.original_erased_cash_base_discharge(${e},'${h}')`,
      'ok'
    );
    q(
      `CREATE OR REPLACE FUNCTION public.fn_ca_tally_balance_move() RETURNS trigger LANGUAGE plpgsql AS $b$BEGIN /* moved */ RETURN NEW;END$b$;`,
      'ok'
    );
    expect(q(`SELECT smarter_private.original_erased_cash_base_discharge(${e},'${h}')`, 'ok')).toBe(
      before
    );
  });

  it('refuses an unknown request, a non-postgres caller and an event with no certificate', () => {
    const unknown = psql(
      `SELECT smarter_private.original_erased_cash_base_discharge(42309154,'${'0'.repeat(32)}')`,
      'ok'
    );
    expect(unknown.stderr).toContain('original_cash_discharge_unknown_request');
    const asOther = psql(
      `CREATE ROLE intruder LOGIN SUPERUSER; SET SESSION AUTHORIZATION intruder;
       SELECT smarter_private.original_erased_cash_base_discharge(42309154,'dcc2248b35d55e8c3239044f5e5e2869');`,
      'ok'
    );
    expect(asOther.stderr).toContain('original_cash_discharge_caller_refused');
    const pending = psql(
      `BEGIN; ALTER TABLE smarter_private.original_erased_cash_base_discharges DISABLE TRIGGER original_cash_discharge_immutable;
       DELETE FROM smarter_private.original_erased_cash_base_discharges WHERE event_id=42309154;
       SELECT smarter_private.original_erased_cash_base_discharge(42309154,'dcc2248b35d55e8c3239044f5e5e2869'); ROLLBACK;`,
      'ok'
    );
    expect(pending.stderr).toContain('original_cash_discharge_retired');
  });

  it('cannot write: PostgreSQL refuses DML in its STABLE body', () => {
    const r = psql(
      `BEGIN;
       CREATE OR REPLACE FUNCTION pg_temp.w() RETURNS void LANGUAGE plpgsql STABLE AS $b$BEGIN
        INSERT INTO smarter_private.original_erased_cash_base_discharges VALUES (9,'x');END$b$;
       SELECT pg_temp.w(); ROLLBACK;`,
      'ok'
    );
    expect(r.stderr).toMatch(/INSERT is not allowed in a non-volatile function/);
    const src = q(`SELECT prosrc FROM pg_proc WHERE oid='${W}'::regprocedure`, 'ok');
    expect(src).not.toMatch(
      /\b(INSERT|UPDATE|DELETE)\b|fn_ca_restore_erased_seat_credit|[0-9a-f]{32}/
    );
  });

  it('refuses itself on a changed preimage, an incomplete set, a non-discharged receipt or a false authority', () => {
    fixture('chg');
    q(
      `DO $$DECLARE d text:=pg_get_functiondef('${W}'::regprocedure);BEGIN EXECUTE replace(d,'original_cash_discharge_writer_busy','original_cash_discharge_writer_busy2');END$$;`,
      'chg'
    );
    expect(install('chg').stderr).toContain('the writer is not the qualified preimage');

    fixture('six');
    q(
      `ALTER TABLE smarter_private.original_erased_cash_base_discharges DISABLE TRIGGER original_cash_discharge_immutable;
       DELETE FROM smarter_private.original_erased_cash_base_discharges WHERE event_id=42626673;`,
      'six'
    );
    expect(install('six').stderr).toContain('the finite discharge set is not complete');

    fixture('rcpt');
    q(
      `CREATE OR REPLACE FUNCTION smarter_private.original_erased_cash_base_discharge_receipt(e bigint,h text)
       RETURNS jsonb LANGUAGE sql STABLE AS $b$ SELECT jsonb_build_object('status','blocked','reason','original_cash_financial_rows_changed') $b$;`,
      'rcpt'
    );
    expect(install('rcpt').stderr).toMatch(
      /source authority is not true before the move|finite discharge set is not complete/
    );

    fixture('auth');
    q(
      `DROP FUNCTION smarter_private.original_erased_cash_base_expected_hash(bigint) CASCADE;`,
      'auth'
    );
    const r = install('auth');
    expect(r.status).not.toBe(0);
    for (const db of ['six', 'rcpt', 'auth'])
      expect(q(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${W}'::regprocedure`, db)).toBe(PRE_SRC);
    expect(
      q(`SELECT strpos(prosrc,'writer_busy2')>0 FROM pg_proc WHERE oid='${W}'::regprocedure`, 'chg')
    ).toBe('t');
  });

  it('without the authority pin move the applier refuses it as a stale pin', () => {
    fixture('nomove');
    // Drop the helper that moves the pin and this file's own post-check, so
    // the applier's guard is the only thing left to notice.
    const withoutMove = SQL.replace(
      /^CREATE FUNCTION pg_temp\.ca_move_discharger_pin[\s\S]*?^DROP FUNCTION pg_temp\.ca_move_discharger_pin\(regprocedure\);$/m,
      ''
    ).replace(/^DO \$post\$[\s\S]*?^\$post\$;$/m, '');
    expect(withoutMove).not.toContain('ca_move_discharger_pin');
    expect(withoutMove).not.toContain('$post$');
    const r = install('nomove', withoutMove);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('migration_left_a_stale_pin');
    expect(r.stderr).toContain(PRE_DEF);
    expect(q(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${W}'::regprocedure`, 'nomove')).toBe(
      PRE_SRC
    );
  });
});
