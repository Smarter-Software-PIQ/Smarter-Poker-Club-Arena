import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const base = 'scripts/ci/fixtures/split-late-return/';
const rows = JSON.parse(readFileSync(base + 'actual-functions.json', 'utf8'));
const migration = readFileSync(
  'supabase/retired-unapplied/20261109132114_split_late_credit_journals_its_own_return.sql',
  'utf8'
);
it('retains the qualified historical nested return source after its installed successor supersedes it', () => {
  const original = rows.find(
    (row: { proname: string }) => row.proname === 'fn_ca_horse_split_return_late_credit'
  ).body;
  expect(createHash('md5').update(original).digest('hex')).toBe('e1bd766347c196e52e891da762e76403');
  expect(migration).toContain("set_config('app.ledger_autoskip_club_members','',true)");
  expect(migration).toContain("'app.cash_original_debit_ledger'");
  expect(migration).toContain('split_late_return_preimage_changed');
  expect(migration.split('\n')[0]).toBe('-- SUPERSEDED BY 20261109140919');
  expect(migration).not.toMatch(
    /fn_settle_accounting_rakeback_stage|UPDATE public\.|INSERT INTO|GRANT|REVOKE/
  );
});
it('runs the composed original trigger and deferred refusal under both caller modes', () => {
  const native = readFileSync('scripts/ci/test-split-late-return-postgres.py', 'utf8');
  const wiring = readFileSync(base + 'wiring.sql', 'utf8');
  for (const name of [
    'fn_club_members_ledger_writer',
    'fn_ca_autoledger',
    'fn_ca_tally_ledger_leg',
    'fn_ca_tally_balance_move',
    'fn_ca_chip_ledger_enrich',
    'fn_ca_balance_has_its_ledger_row',
  ]) {
    expect(wiring).toContain(name);
    expect(rows.some((row: { proname: string }) => row.proname === name)).toBe(true);
  }
  expect(native).toContain("exercise('1',True)");
  expect(native).toContain("for skip in ['1','']");
  expect(native).toContain('repeat=True');
  expect(readFileSync('.github/workflows/weekly-refusal-cover.yml', 'utf8')).toContain(
    'python3 -B scripts/ci/test-split-late-return-postgres.py'
  );
});
