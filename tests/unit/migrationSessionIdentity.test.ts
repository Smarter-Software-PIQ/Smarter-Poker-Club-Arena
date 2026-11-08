import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ESM helper shared with the installer
import {
  bindMigrationSession,
  assertOrdinaryMigrationBudget,
} from '../../scripts/ci/migration-session-identity.mjs';

describe('migration identity belongs to the owning transaction', () => {
  it('binds after BEGIN while preserving migration settings and embedded history bytes', () => {
    const original = "-- Qualified file\nBEGIN;\nSET LOCAL statement_timeout = '8min';\nCOMMIT;";
    const history = original.replace('COMMIT;', `SELECT $history$${original}$history$;\nCOMMIT;`);
    const result = bindMigrationSession(history);
    expect(result).toContain("BEGIN;\nSET LOCAL application_name = 'apply-recorded-migration';");
    expect(result).toContain("SET LOCAL statement_timeout = '8min';");
    expect(result).toContain(`$history$${original}$history$`);
    expect(result.match(/SET LOCAL application_name/g)).toHaveLength(1);
  });
  it('binds the budget on the transaction backend even through a transaction pooler', () => {
    expect(bindMigrationSession('BEGIN;\nSELECT 1;\nCOMMIT;', 12000)).toContain(
      "SET LOCAL transaction_timeout = '12000ms';"
    );
    expect(bindMigrationSession('BEGIN;\nCOMMIT;')).not.toContain('transaction_timeout');
    expect(() => bindMigrationSession('BEGIN;\nCOMMIT;', 0)).toThrow(/budget/);
  });
  it('copies the installer root imports into both isolated native fixtures', () => {
    for (const path of [
      'scripts/ci/test_launch_reset_installer.py',
      'scripts/ci/fixtures/launch-reset/maintenance-thaw-repair/qualify.py',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain("original.decode('utf-8')):copy_module(dep)");
    }
  });
  it('refuses to send an unbound transaction', () => {
    expect(() => bindMigrationSession('SELECT 1;')).toThrow(/BEGIN/);
  });
  it('binds both the ordinary and settlement-lane owning send, with native enforcement', () => {
    const door = readFileSync('scripts/ci/apply-recorded-migration.mjs', 'utf8');
    expect(door).toContain('SETTLEMENT_LANE ? atomicSQL : admittedSQL,');
    expect(door).toContain('ordinaryTransaction ? ordinaryBudgetMs : null');
    expect(door).toContain('ordinaryBudgetMs = ordinaryMigrationBudgetMs(file, sql);');
    expect(door.match(/client\.query\(transactionSQL\)/g)).toHaveLength(2);
    expect(readFileSync('scripts/ci/test-data-console-postgres-contracts.sh', 'utf8')).toContain(
      'python3 -B "$repo/scripts/ci/test-a-long-outside-snapshot-does-not-stall-the-tables.py"'
    );
  });
});

describe('ordinary migration transaction budget', () => {
  it.each([
    "SET LOCAL transaction_timeout='0';",
    "SET transaction_timeout='60s';",
    'SET SESSION transaction_timeout TO DEFAULT;',
    'RESET transaction_timeout;',
    'RESET ALL;',
    "SELECT set_config('transaction_timeout','0',true);",
  ])('refuses a source that can remove the bound: %s', (sql) => {
    expect(() => assertOrdinaryMigrationBudget(sql, 12000)).toThrow(/budget/);
  });
  it.each([
    "SET LOCAL transaction_timeout='8s';",
    "SET LOCAL transaction_timeout='12000ms';",
    "SET LOCAL transaction_timeout='0.1min';",
    "SET LOCAL statement_timeout='120s';",
    "-- SET transaction_timeout='0';\nSELECT 1;",
    '/* RESET ALL; */ SELECT 1;',
  ])('preserves shorter bounds and independent statement settings: %s', (sql) => {
    expect(() => assertOrdinaryMigrationBudget(sql, 12000)).not.toThrow();
  });
});
