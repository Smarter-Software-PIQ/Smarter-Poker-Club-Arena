import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Incident ee77584d (2026-11-11): 20261110234927 added a Lightning branch to
 * fn_post_commit_handoff_is_a_warning(), but the trigger that calls it was
 * created with `WHEN (new.source = 'ServerTableEngine...')`, so Postgres never
 * called the function for the Lightning source and the branch was dead code.
 * 79 critical pages followed for a designed handoff.
 *
 * The law: every source the LATEST definition of the function compares with
 * `new.source = '...'` must be admitted by the WHEN clause of the LATEST
 * migration that (re)creates the trigger.
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const FN = 'fn_post_commit_handoff_is_a_warning';
const TRIGGER = 'a2_post_commit_handoff_is_a_warning';

function latest(pattern: RegExp): { file: string; text: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const text = readFileSync(join(MIGRATIONS, files[i]), 'utf8');
    if (pattern.test(text)) return { file: files[i], text };
  }
  throw new Error(`no migration matches ${pattern}`);
}

describe('the handoff trigger reaches every source its function names', () => {
  it('admits each source the function compares for equality', () => {
    const fn = latest(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${FN}\\(`));
    const body = fn.text.slice(fn.text.indexOf(`FUNCTION public.${FN}(`));
    const named = [...body.matchAll(/new\.source\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(2);

    const trg = latest(new RegExp(`CREATE TRIGGER ${TRIGGER}\\b`));
    const create = trg.text.slice(trg.text.indexOf(`CREATE TRIGGER ${TRIGGER}`));
    const when = create.slice(0, create.indexOf('EXECUTE FUNCTION'));
    for (const source of new Set(named)) {
      expect(when, `${trg.file} WHEN must admit ${source} (named by ${fn.file})`).toContain(
        `'${source}'`
      );
    }
  });
});
