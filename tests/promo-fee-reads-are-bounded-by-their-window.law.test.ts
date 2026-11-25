import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * PROMO FEE READS ARE BOUNDED BY THEIR WINDOW (2026-11-24, incident fix audit).
 * The cost of fn_ca_promo_fee_events grew with a member's whole rake history
 * twice: on 2026-11-17 (576 Lightning post-commit timeouts; fixed by #11229) and
 * on 2026-11-22 (incident 9408cfd4; fixed by 20261122203048). Both times the
 * reader of rake_attributions had no lower created_at bound. This law fails the
 * build when the newest definition of the reader reads rake_attributions without
 * a lower created_at bound, whatever form the bound takes.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'fn_ca_promo_fee_events';

export function newestDefinition(
  files: string[],
  read: (f: string) => string
): { file: string; sql: string } | null {
  let found: { file: string; sql: string } | null = null;
  for (const f of files) {
    const sql = read(f);
    if (
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${FN}\\s*\\(`, 'i').test(sql)
    )
      found = { file: f, sql };
  }
  return found;
}

/** Every rake_attributions read in the body carries a lower created_at bound in its WHERE. */
export function rakeReadsAreBounded(sql: string): boolean {
  const reads = [
    ...sql.matchAll(
      /\bFROM\s+public\.rake_attributions\b[\s\S]*?(?=\)\s*,\s*\w+\s+AS\b|\)\s*SELECT\b|;)/gi
    ),
  ];
  if (!reads.length) return true;
  return reads.every((m) => /\bcreated_at\s*>=\s*/i.test(m[0]));
}

describe('promo fee reads are bounded by their window', () => {
  // git grep narrows the corpus to the migrations that name the reader at all.
  const files = execFileSync(
    'git',
    ['grep', '-lz', '--untracked', FN, '--', 'supabase/migrations'],
    {
      cwd: join(DIR, '..', '..'),
      encoding: 'utf8',
    }
  )
    .split('\0')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice('supabase/migrations/'.length))
    .sort();
  const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

  it('the newest reader bounds every rake_attributions read by created_at', () => {
    const def = newestDefinition(files, read);
    expect(def, `no migration defines ${FN}`).not.toBeNull();
    expect(
      rakeReadsAreBounded(def!.sql),
      `${def!.file} reads rake_attributions without a lower created_at bound`
    ).toBe(true);
  });

  it('would have failed on the unbounded reader of #11112', () => {
    const before = newestDefinition(
      files.filter((f) => f < '20261117000000'),
      read
    );
    expect(before).not.toBeNull();
    expect(rakeReadsAreBounded(before!.sql)).toBe(false);
  });
});
