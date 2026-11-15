/**
 * A "char" catalog column is cast to text before ||.
 *
 * pg_proc.provolatile, prokind and relkind are the one-byte "char" type, and
 * `"char" || text` has two candidate operators, so Postgres refuses with
 * 42725 "operator is not unique". On 2026-11-15 migration 20261115164547's
 * closing self-check wrote `p.provolatile || CASE ... END`, the applier's one
 * attempt rolled the whole file back, and the merged reader stayed
 * uninstalled (incident c1a85d20). This scans every migration so the same
 * line cannot merge again.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../supabase/migrations');
const CHAR_COLUMNS = ['provolatile', 'prokind', 'proparallel', 'relkind', 'relpersistence', 'contype', 'typtype'];
// Files that installed before this rule; they are history and never run again.
const INSTALLED_BEFORE_THE_RULE = new Set<string>([]);

describe('a "char" catalog column is cast before concatenation', () => {
  it('no migration concatenates an uncast "char" catalog column', () => {
    const re = new RegExp(`\\b(?:\\w+\\.)?(${CHAR_COLUMNS.join('|')})\\s*\\|\\|`, 'g');
    const offenders: string[] = [];
    for (const name of readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
      if (INSTALLED_BEFORE_THE_RULE.has(name)) continue;
      const sql = readFileSync(join(DIR, name), 'utf8');
      for (const m of sql.matchAll(re)) offenders.push(`${name}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
