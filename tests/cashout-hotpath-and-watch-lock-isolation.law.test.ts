import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');

function readLatestFunctionDef(fnName: string): { file: string; def: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\s*\\([\\s\\S]*?\\$([a-zA-Z0-9_]*)\\$([\\s\\S]*?)\\$\\1\\$`,
    'i'
  );
  let latest: { file: string; def: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    if (!sql.includes(fnName)) continue;
    const match = sql.match(re);
    if (match) latest = { file, def: match[0] };
  }
  if (!latest) throw new Error(`Could not locate latest definition for public.${fnName}`);
  return latest;
}

describe('cashout hot-path and watch lock-timeout isolation', () => {
  it('atomic_credit_wallet_and_log checks active seats (left_at IS NULL) first with historical fallback', () => {
    const { file, def } = readLatestFunctionDef('atomic_credit_wallet_and_log');
    const activeIdx = def.indexOf('AND ts.left_at IS NULL');
    const fallbackIdx = def.indexOf('IF v_club_id IS NULL THEN');
    expect(activeIdx, `${file} must query active seats (left_at IS NULL) first`).toBeGreaterThan(
      -1
    );
    expect(fallbackIdx, `${file} must keep fallback lookup for vacated seats`).toBeGreaterThan(
      activeIdx
    );
  });

  it('fn_ca_operator_floor_entry_guard returns early on seat exit before acquiring advisory lock 530093', () => {
    const { file, def } = readLatestFunctionDef('fn_ca_operator_floor_entry_guard');
    const returnIdx = def.indexOf('RETURN NEW;');
    const lockIdx = def.indexOf('pg_advisory_xact_lock_shared(530093)');
    expect(returnIdx, `${file} must short-circuit RETURN NEW on non-entry updates`).toBeGreaterThan(
      -1
    );
    expect(lockIdx, `${file} must still guard seat admissions with lock 530093`).toBeGreaterThan(
      returnIdx
    );
  });

  it('every new fn_ca_*_watch function from 20261121154220 onward declares a bounded lock_timeout', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f > '20261121154220')
      .sort();
    const watchHeaderRe =
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(fn_ca_[a-z0-9_]+_watch)\s*\([^)]*\)[\s\S]*?AS\s+\$/gi;
    const missing: string[] = [];
    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      for (const m of sql.matchAll(watchHeaderRe)) {
        const header = m[0];
        if (!/SET\s+lock_timeout\b/i.test(header)) {
          missing.push(`${file}: public.${m[1]} missing SET lock_timeout`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
