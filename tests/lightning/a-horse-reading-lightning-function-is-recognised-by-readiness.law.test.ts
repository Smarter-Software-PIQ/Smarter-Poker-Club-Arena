import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Production Alerts row 371597, 2026-11-12.
//
// fn_lightning_rollout_readiness answers invariants.law_10_5 by scanning every
// public fn_lightning_* function and refusing any whose comment-stripped
// definition mentions is_horse or horse_id. CLAUDE.md 10.5 still permits
// horse plumbing (the horse's input device, the code that seats and paces the
// fleet), so the scan recognises each such function by its exact identity:
// signature, md5 of the installed definition, owner and grants
// (20261106155602 for fn_lightning_auto_rebuy).
//
// 20261111214248 (#10530) installed fn_lightning_horse_admit_paced, which
// reads is_horse, and nothing taught readiness its identity. law_10_5 went
// false on production and every Post-Deploy E2E run failed the Lightning
// operator certificate from then on. Because the recognition is pinned to an
// exact md5, the same failure follows any later redefinition of a recognised
// function too.
//
// This law runs on every pull request (Client Unit Tests) and refuses the
// shape before merge: for every fn_lightning_* function whose LATEST
// definition in supabase/migrations reads horse identity, a readiness
// recognition naming that exact signature must exist at the same or a later
// version. A definition that drops the horse read needs nothing.

const root = resolve(__dirname, '../..');
const dir = resolve(root, 'supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();
const version = (f: string) => f.slice(0, 14);
const HORSE = /is_horse|horse_id/;
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

type Definition = { file: string; readsHorse: boolean };

function latestDefinitions(): Map<string, Definition> {
  const latest = new Map<string, Definition>();
  const create =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(fn_lightning_[a-z0-9_]+)\s*\(([^)]*)\)[\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)/gi;
  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), 'utf8');
    for (const m of sql.matchAll(create)) {
      const [, name, , tag] = m;
      if (name === 'fn_lightning_rollout_readiness') continue;
      const start = (m.index ?? 0) + m[0].length;
      const end = sql.indexOf(tag, start);
      if (end < 0) continue;
      const body = stripComments(sql.slice(start, end));
      latest.set(name, { file, readsHorse: HORSE.test(body) });
    }
    for (const m of sql.matchAll(
      /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(fn_lightning_[a-z0-9_]+)/gi
    ))
      latest.delete(m[1]);
  }
  return latest;
}

function recognitions(name: string): string[] {
  // A readiness recognition patches fn_lightning_rollout_readiness and names
  // the function's exact signature inside to_regprocedure(...) with a pinned md5.
  const named = new RegExp(`to_regprocedure\\('public\\.${name}\\(`);
  return files.filter((file) => {
    const sql = stripComments(readFileSync(resolve(dir, file), 'utf8'));
    return (
      sql.includes('fn_lightning_rollout_readiness') &&
      named.test(sql) &&
      /md5\(pg_get_functiondef\(p\.oid\)\)\s*=\s*'[0-9a-f]{32}'/.test(sql)
    );
  });
}

describe('a horse-reading Lightning function is recognised by readiness (row 371597)', () => {
  const horseReaders = [...latestDefinitions()].filter(([, d]) => d.readsHorse);

  it('finds the horse plumbing this law exists for', () => {
    const names = horseReaders.map(([name]) => name);
    expect(names).toContain('fn_lightning_auto_rebuy');
    expect(names).toContain('fn_lightning_horse_admit_paced');
  });

  it('every latest horse-reading definition has a readiness recognition at or after it', () => {
    const unrecognised = horseReaders
      .filter(([name, d]) => !recognitions(name).some((r) => version(r) >= version(d.file)))
      .map(([name, d]) => `${name} (latest definition ${d.file})`);
    expect(unrecognised).toEqual([]);
  });

  it('the horse arrival pacing recognition pins the installed definition and refuses every caller role', () => {
    const file = files.find((f) => f.startsWith('20261112135242_'));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(dir, file as string), 'utf8');
    expect(sql).toContain("md5(pg_get_functiondef(p.oid)) = 'ba5d6df55992dde8d2dce9a9295816cd'");
    for (const role of ['service_role', 'authenticated', 'anon'])
      expect(sql).toContain(`AND NOT has_function_privilege('${role}', p.oid, 'EXECUTE')`);
    expect(sql).toContain("IF md5(v_before) <> 'd2e611fa3e858c45213a40c80829626c'");
  });
});
