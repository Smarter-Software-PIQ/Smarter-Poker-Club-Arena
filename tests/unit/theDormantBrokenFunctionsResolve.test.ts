import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 20261115020406 refuses, at COMMIT, a plpgsql function that calls a signature
// that does not exist. Its audit of the functions already installed found
// fn_gto_v31_promote_dataset_epoch calling pgcrypto's digest() from a
// search_path that cannot see it, and pgmigrate wrapping the exec_sql that
// 20260908042700 dropped on purpose. This pins the repair of both.
const root = join(__dirname, '..', '..');
const migrations = join(root, 'supabase', 'migrations');
const file = readdirSync(migrations).find((name) =>
  name.endsWith('_the_dormant_broken_functions_resolve_or_are_retired.sql')
);

function migration(): string {
  expect(file, 'the repair migration exists').toBeDefined();
  return readFileSync(join(migrations, file as string), 'utf8');
}

describe('the dormant broken functions resolve or are retired', () => {
  it('lets the V31 promotion resolve digest() from the extensions schema', () => {
    const sql = migration();
    expect(sql).toMatch(
      /ALTER FUNCTION public\.fn_gto_v31_promote_dataset_epoch\(uuid, text, text\)\s+SET search_path = public, extensions;/
    );
    // The body is not rewritten: only the search_path changes.
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.fn_gto_v31_promote_dataset_epoch/);
  });

  it('retires pgmigrate, the wrapper left behind when exec_sql was dropped', () => {
    const sql = migration();
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.pgmigrate(text);');
    const retired = readFileSync(
      join(migrations, '20260908042700_retire_public_arbitrary_sql_executor.sql'),
      'utf8'
    );
    expect(retired).toContain('DROP FUNCTION IF EXISTS public.exec_sql(text);');
  });

  it('is one transaction with a short lock timeout and a live proof', () => {
    const sql = migration();
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toMatch(/^-- @live-proof: .*search_path=%extensions%.*pgmigrate\(text\)'\) IS NULL$/m);
  });
});
