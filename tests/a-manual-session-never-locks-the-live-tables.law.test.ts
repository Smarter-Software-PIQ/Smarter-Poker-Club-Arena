/**
 * LAW: A MANUAL SESSION NEVER LOCKS THE LIVE TABLES (incident 075013fd).
 *
 * 2026-11-18 23:32-23:34 UTC: an ad-hoc postgres session through Supavisor
 * re-ran 20260308_tournament_bounties_and_columns.sql on production statement
 * by statement. Thirty no-op ALTER TABLE ... ADD COLUMN IF NOT EXISTS each
 * queued ACCESS EXCLUSIVE on tournaments (then tournament_players):
 * tournaments stalled ~100 s and 13 cash tables 16-57 s.
 *
 * What this pins (native proof: scripts/ci/test-manual-ddl-guard-postgres.py,
 * run by manual-ddl-guard-proof.yml on PostgreSQL 16 and 17):
 *   1. The database refuses table-locking DDL on a live table at
 *      ddl_command_start, before any lock, from every postgres session that is
 *      not the claimed migration applier, with a ddl_command_end backstop.
 *   2. The applier is a claim bound to the backend and transaction, never
 *      application_name alone, and the claim commits only with its exact
 *      history row; a claim for an applied migration is refused.
 *   3. ADD COLUMN IF NOT EXISTS of an existing live-table column is refused
 *      before the lock, for every session.
 *   4. The applier's binder claims exactly the history the applier records,
 *      so a change to either cannot silently drop the claim.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error plain ESM helper shared with the installer
import {
  applierClaimSQL,
  bindMigrationSession,
} from '../scripts/ci/migration-session-identity.mjs';
// @ts-expect-error plain ESM helper shared with the pre-merge check
import { NOT_REHEARSED } from '../scripts/ci/migration-guards-before-merge.mjs';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const MIG = read(
  'supabase/migrations/20261119053515_a_manual_session_never_locks_the_live_tables.sql'
);
const APPLIER = read('scripts/ci/apply-recorded-migration.mjs');
const WORKFLOW = read('.github/workflows/manual-ddl-guard-proof.yml');

describe('a manual session never locks the live tables', () => {
  it('is one transaction that creates its event triggers last', () => {
    expect(MIG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIG.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(MIG).toMatch(/SET LOCAL lock_timeout = '3s';/);
    const start = MIG.indexOf(
      'CREATE EVENT TRIGGER ca_live_tables_refuse_manual_ddl ON ddl_command_start'
    );
    const end = MIG.indexOf(
      'CREATE EVENT TRIGGER ca_live_tables_refuse_manual_ddl_held ON ddl_command_end'
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(MIG.slice(end)).not.toMatch(/\bCREATE (TABLE|FUNCTION|TRIGGER|INDEX)\b/);
  });

  it('lists the tables the incident and the 2026-10-22 storm stalled as live', () => {
    for (const t of [
      'tournaments',
      'tournament_players',
      'tables',
      'table_seats',
      'hand_history',
      'clubs',
      'union_wallets',
      'profiles',
    ])
      expect(MIG).toContain(`('${t}',`);
  });

  it('decides before the lock, by the claim, and never by application_name', () => {
    const guard = MIG.slice(
      MIG.indexOf('CREATE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl()'),
      MIG.indexOf('CREATE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl_held()')
    );
    expect(guard).toContain('smarter_private.fn_ca_migration_applier_claimed()');
    expect(guard).toContain('smarter_private.fn_ca_live_table_noop_add_columns(v_query)');
    expect(guard).not.toMatch(/apply-recorded-migration|install-window-migrations|pg_cron/);
    // The no-op refusal is decided before, and independent of, the claim.
    expect(guard.indexOf('fn_ca_live_table_noop_add_columns')).toBeLessThan(
      guard.indexOf('AND NOT v_claimed')
    );
    const claimed = MIG.slice(
      MIG.indexOf('CREATE FUNCTION smarter_private.fn_ca_migration_applier_claimed()'),
      MIG.indexOf('CREATE FUNCTION smarter_private.fn_ca_ddl_code(')
    );
    for (const bound of [
      'c.txid = v_xid',
      'c.pid = pg_catalog.pg_backend_pid()',
      'c.nonce = v_marker::uuid',
      'a.backend_start = c.backend_start',
    ])
      expect(claimed).toContain(bound);
  });

  it('refuses a re-run and a claim that does not record its history', () => {
    expect(MIG).toContain(
      "'migration_already_applied: %s_%s is already recorded (%s); a re-run is refused'"
    );
    expect(MIG).toMatch(
      /CREATE CONSTRAINT TRIGGER ca_migration_applier_claim_is_recorded\s+AFTER INSERT ON smarter_private\.ca_migration_applier_claims\s+DEFERRABLE INITIALLY DEFERRED/
    );
    expect(MIG).toContain('pg_catalog.md5(m.statements[1]) = NEW.source_md5');
  });

  it('the binder claims exactly the history the applier records', () => {
    const template = /const historyStatement = `([\s\S]*?)`;/.exec(APPLIER)![1];
    const version = '20991231000100';
    const slug = 'a_fixture';
    const source = 'BEGIN;\nALTER TABLE public.tournaments ADD COLUMN x integer;\nCOMMIT;\n';
    const tag = `$ca_file_history_${version}$`;
    const history = template
      .replaceAll('${version}', version)
      .replaceAll('${slug}', slug)
      .replaceAll('${exactSQLLiteral}', tag + source + tag);
    const atomic = source.replace(/COMMIT;\n$/, history + '\nCOMMIT;');
    const md5 = createHash('md5').update(source, 'utf8').digest('hex');
    expect(applierClaimSQL(atomic)).toContain(
      `PERFORM smarter_private.fn_ca_migration_applier_claim('${version}', '${slug}', '${md5}');`
    );
    const bound = bindMigrationSession(atomic, 12000);
    expect(bound.indexOf('fn_ca_migration_applier_claim')).toBeLessThan(
      bound.indexOf('ALTER TABLE')
    );
    expect(bound).toContain(
      "to_regprocedure('smarter_private.fn_ca_migration_applier_claim(text,text,text)') IS NOT NULL"
    );
    // A transaction with no history row is not an install and claims nothing.
    expect(applierClaimSQL(source)).toBe('');
    expect(() =>
      bindMigrationSession('BEGIN;\nSELECT $ca_applier_claim$x$ca_applier_claim$;\nCOMMIT;')
    ).toThrow(/reserved/);
  });

  it('is proved natively on PostgreSQL 16 and 17, and not re-armed on the plain-psql rehearsal', () => {
    expect(WORKFLOW).toContain('scripts/ci/test-manual-ddl-guard-postgres.py --pg-bin "$pg16"');
    expect(WORKFLOW).toContain(
      'scripts/ci/test-manual-ddl-guard-postgres.py --pg-bin /usr/lib/postgresql/17/bin'
    );
    expect(
      WORKFLOW.match(/grep -q '\^PASS  every manual-DDL guard assertion held\$'/g)
    ).toHaveLength(2);
    expect(Object.keys(NOT_REHEARSED)).toEqual(
      expect.arrayContaining([
        'ca_live_tables_refuse_manual_ddl',
        'ca_live_tables_refuse_manual_ddl_held',
      ])
    );
  });
});
