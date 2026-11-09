/**
 * LAW: A SHARED TRIGGER READS ONLY THE FIELDS ITS TABLE HAS (2026-11-09).
 *
 * On 2026-11-07 fn_guard_managed_game_lifecycle(), attached to both
 * public.tournaments and public.tables, gained a condition reading
 * OLD.late_reg_levels and NEW.late_reg_levels in the same expression as its
 * TG_TABLE_NAME='tournaments' test. tables has no late_reg_levels, PL/pgSQL
 * plans the whole condition, and every tables UPDATE failed
 * (`record "old" has no field "late_reg_levels"`), the 3 AM lobby close among
 * them: 108 failures on 2026-11-08 between 03:00 and 05:05 Chicago, until
 * 20261108101627 moved the read inside its own IF TG_TABLE_NAME block.
 *
 * This fails when a trigger function attached to more than one table reads a
 * NEW/OLD field that only some of those tables have, outside a branch that
 * has already tested which relation fired it (scripts/ci/shared-trigger-fields.mjs).
 *
 * Checked against: the production snapshot of every shared PL/pgSQL trigger
 * function (scripts/ci/fixtures/shared-trigger-snapshot.json, 155 functions),
 * and every function body a NEWER migration defines for one of them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findUnguardedFields } from '../scripts/ci/shared-trigger-fields.mjs';

const ROOT = join(__dirname, '..');
const SNAP = JSON.parse(
  readFileSync(join(ROOT, 'scripts/ci/fixtures/shared-trigger-snapshot.json'), 'utf8')
) as {
  observed_at: string;
  functions: { name: string; tables: string[]; body: string }[];
  columns: Record<string, string[]>;
};
const colsFor = (tables: string[]) =>
  Object.fromEntries(tables.map((t) => [t, SNAP.columns[t] ?? []]));
const describeFindings = (f: ReturnType<typeof findUnguardedFields>) =>
  f.map((x) => `${x.ref} (line ${x.line}) is missing on ${x.lacking.join(', ')}`).join('; ');

describe('a shared trigger reads only the fields its table has', () => {
  it('catches the 2026-11-07 fn_guard_managed_game_lifecycle defect', () => {
    const live = SNAP.functions.find((f) => f.name === 'fn_guard_managed_game_lifecycle()');
    expect(live?.tables).toEqual(['tables', 'tournaments']);
    const fix = readFileSync(
      join(
        ROOT,
        'supabase/migrations/20261108101627_scope_tournament_cutoff_fields_to_tournament_trigger_rows.sql'
      ),
      'utf8'
    );
    const before = /before_clause constant text := \$before\$([\s\S]*?)\$before\$;/.exec(fix)![1];
    const after = /after_clause constant text := \$after\$([\s\S]*?)\$after\$;/.exec(fix)![1];
    expect(live!.body).toContain(after);
    const nov7 = live!.body.replace(after, before);
    const found = findUnguardedFields(nov7, colsFor(live!.tables));
    expect(found.map((f) => f.ref).sort()).toEqual(['NEW.late_reg_levels', 'OLD.late_reg_levels']);
    expect(found.every((f) => f.lacking.join() === 'tables')).toBe(true);
    // The repaired body reads the field only inside its relation branch.
    expect(findUnguardedFields(live!.body, colsFor(live!.tables))).toEqual([]);
  });

  it('accepts the guards the planner honours and refuses the one it does not', () => {
    const cols = { a: ['id', 'only_a'], b: ['id'] };
    const ok = (body: string) => expect(findUnguardedFields(body, cols)).toEqual([]);
    const bad = (body: string) =>
      expect(findUnguardedFields(body, cols).map((f) => f.ref)).toEqual(['NEW.only_a']);
    ok(
      `BEGIN IF TG_TABLE_NAME = 'a' THEN IF NEW.only_a > 0 THEN RETURN NEW; END IF; END IF; RETURN NEW; END`
    );
    ok(
      `BEGIN IF TG_TABLE_NAME = 'b' THEN RETURN NEW; END IF; IF NEW.only_a > 0 THEN RAISE EXCEPTION 'x'; END IF; RETURN NEW; END`
    );
    ok(`BEGIN IF TG_TABLE_NAME = 'b' THEN x := 1; ELSE x := NEW.only_a; END IF; RETURN NEW; END`);
    ok(
      `BEGIN CASE TG_TABLE_NAME WHEN 'a' THEN x := NEW.only_a; ELSE NULL; END CASE; RETURN NEW; END`
    );
    ok(`BEGIN x := NEW.id; RETURN NEW; END -- NEW.only_a in a comment`);
    bad(`BEGIN IF TG_TABLE_NAME = 'a' AND NEW.only_a > 0 THEN RETURN NEW; END IF; RETURN NEW; END`);
    bad(`BEGIN IF TG_OP = 'UPDATE' THEN x := NEW.only_a; END IF; RETURN NEW; END`);
  });

  it(`holds for every shared trigger function on production (${SNAP.observed_at})`, () => {
    expect(SNAP.functions.length).toBeGreaterThan(100);
    const failing = SNAP.functions
      .map((f) => ({ f, found: findUnguardedFields(f.body, colsFor(f.tables)) }))
      .filter((x) => x.found.length)
      .map((x) => `${x.f.name} on ${x.f.tables.join(', ')}: ${describeFindings(x.found)}`);
    expect(failing, failing.join('\n')).toEqual([]);
  });

  it('holds for every newer migration that redefines a shared trigger function', () => {
    const shared = new Map(
      SNAP.functions.map((f) => [f.name.replace(/\(.*$/, '').replace(/^public\./, ''), f])
    );
    const dir = join(ROOT, 'supabase/migrations');
    const newer = readdirSync(dir).filter(
      (n) => n.endsWith('.sql') && n.slice(0, 14) > '20261109040500'
    );
    const failing: string[] = [];
    for (const file of newer) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const re =
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.|smarter_private\.)?"?([a-z_][a-z0-9_]*)"?\s*\(\s*\)\s+RETURNS\s+trigger[\s\S]*?AS\s+(\$[a-z_]*\$)([\s\S]*?)\2/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) {
        const known = shared.get(m[1]) ?? shared.get(`smarter_private.${m[1]}`);
        if (!known) continue;
        const found = findUnguardedFields(m[3], colsFor(known.tables));
        if (found.length) failing.push(`${file} ${m[1]}: ${describeFindings(found)}`);
      }
    }
    expect(failing, failing.join('\n')).toEqual([]);
  });
});
