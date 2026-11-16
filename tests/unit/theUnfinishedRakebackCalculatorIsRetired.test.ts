import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// fn_calculate_rakeback was hollowed out by 20260424001857 (BUG-26) into a
// stub answering {success:false, error:'not_implemented', rakeback:0} and was
// never finished: the weekly accounting coordinator is the rakeback
// calculator. Nothing in the repo or the database called the stub, and it
// still carried EXECUTE for authenticated. This pins its retirement.
const root = join(__dirname, '..', '..');
const migrations = join(root, 'supabase', 'migrations');
const file = readdirSync(migrations).find((name) =>
  name.endsWith('_the_unfinished_rakeback_calculator_is_retired.sql')
);

function migration(): string {
  expect(file, 'the retirement migration exists').toBeDefined();
  return readFileSync(join(migrations, file as string), 'utf8');
}

describe('the unfinished rakeback calculator is retired', () => {
  it('drops the stub and only the stub', () => {
    const sql = migration();
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.fn_calculate_rakeback(uuid, timestamp with time zone, timestamp with time zone);'
    );
    expect(sql.match(/^DROP FUNCTION/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/^CREATE/m);
    // The live money look-up it is often confused with is not touched.
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*fn_player_home_club/);
  });

  it('is one transaction with a short lock timeout and a live proof', () => {
    const sql = migration();
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toMatch(
      /^-- @live-proof: to_regprocedure\('public\.fn_calculate_rakeback\(uuid,timestamptz,timestamptz\)'\) IS NULL$/m
    );
  });

  it('does not come back under a later migration', () => {
    const later = readdirSync(migrations).filter(
      (name) => name > (file as string) && name.endsWith('.sql')
    );
    for (const name of later) {
      const sql = readFileSync(join(migrations, name), 'utf8');
      expect(sql, `${name} recreates fn_calculate_rakeback`).not.toMatch(
        /CREATE (OR REPLACE )?FUNCTION public\.fn_calculate_rakeback\b/
      );
    }
  });
});
