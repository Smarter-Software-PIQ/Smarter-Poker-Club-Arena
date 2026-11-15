/**
 * LAW: a migration that changes a function the cashier release contract pins
 * is named by that contract in the same change.
 *
 * Why (2026-11-15): the post-deploy cashier contract failed on production with
 * "cashier function drift" for five pinned functions. Every change was a
 * reviewed, installed migration: 20261114163238 and 20261114171135 here, and
 * World Hub PR #2841 (20261114174204, 20261114174518) on the shared database.
 * None of them updated scripts/verification-harness/cashier-release-contract.sql,
 * so the certificate kept naming bodies that no longer existed, and the
 * failure was found only after a release.
 *
 * The rule: from 2026-11-14 on, every migration in supabase/migrations, and
 * every sibling migration recorded in scripts/ci/fixtures/world-hub-cashier-
 * migrations-*.json, whose SQL creates, replaces or patches a contract-pinned
 * function must appear in the contract as `version = '<version>'`, beside the
 * re-pinned hash. A migration that only reads a pinned function (a grant
 * check, a live proof) is listed in READ_ONLY below with its reason.
 *
 * Limit: this runs in this repository. A World Hub migration reaches it only
 * once it is recorded in a fixture here; the post-deploy contract remains the
 * check for anything installed before that.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const contract = readFileSync(
  resolve(ROOT, 'scripts/verification-harness/cashier-release-contract.sql'),
  'utf8'
);
const FLOOR = '20261114000000';

/** Migrations that name a pinned function without changing its body. */
const READ_ONLY: Readonly<Record<string, string>> = {};

const pinned = [
  ...new Set(
    [...contract.matchAll(/'signature',\s*'public\.([a-z0-9_]+)\(/g)].map((match) => match[1])
  ),
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pinned functions whose definition this SQL creates, replaces or patches. */
export function changedPinnedFunctions(sql: string, names: readonly string[]): string[] {
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return names.filter((name) => {
    const n = escape(name);
    return (
      new RegExp(`FUNCTION\\s+public\\.${n}\\s*\\(`, 'i').test(code) ||
      new RegExp(`pg_get_functiondef\\(\\s*'public\\.${n}\\(`, 'i').test(code) ||
      new RegExp(`'public\\.${n}\\([^']*\\)'\\s*::\\s*regprocedure`, 'i').test(code) ||
      // a signature handed to a patch loop (ARRAY['public.fn(...)', ...] LOOP);
      // privilege checks, grants and comments only read the function
      code
        .split('\n')
        .some(
          (line) =>
            new RegExp(`'public\\.${n}\\(`, 'i').test(line) &&
            !/has_function_privilege|\b(GRANT|REVOKE|COMMENT ON)\b/i.test(line)
        )
    );
  });
}

function migrations(): Array<{ version: string; sql: string; source: string }> {
  const dir = resolve(ROOT, 'supabase/migrations');
  const local = readdirSync(dir)
    .filter((file) => /^\d{14}_.*\.sql$/.test(file) && file.slice(0, 14) >= FLOOR)
    .map((file) => ({
      version: file.slice(0, 14),
      sql: readFileSync(resolve(dir, file), 'utf8'),
      source: `supabase/migrations/${file}`,
    }));
  const fixtures = resolve(ROOT, 'scripts/ci/fixtures');
  const sibling = readdirSync(fixtures)
    .filter((file) => /^world-hub-cashier-migrations-\d+\.json$/.test(file))
    .flatMap((file) =>
      (
        JSON.parse(readFileSync(resolve(fixtures, file), 'utf8')) as Array<{
          version: string;
          sql: string;
          path: string;
        }>
      ).map((item) => ({ version: item.version, sql: item.sql, source: `World Hub ${item.path}` }))
    );
  return [...local, ...sibling];
}

describe('the cashier release contract names every migration that changed a pinned function', () => {
  it('reads the pinned functions from the contract', () => {
    expect(pinned.length).toBeGreaterThan(50);
    expect(pinned).toContain('fn_cashier_history_feed');
    expect(pinned).toContain('fn_promo_wallet_send_core_20261004');
  });

  it('detects a change, a patch and a regprocedure patch, and ignores comments', () => {
    const names = ['fn_cashier_history_feed', 'fn_cashier_history_page'];
    expect(
      changedPinnedFunctions('CREATE OR REPLACE FUNCTION public.fn_cashier_history_page(', names)
    ).toEqual(['fn_cashier_history_page']);
    expect(
      changedPinnedFunctions(
        "d := pg_get_functiondef('public.fn_cashier_history_feed(uuid)'",
        names
      )
    ).toEqual(['fn_cashier_history_feed']);
    expect(
      changedPinnedFunctions("  'public.fn_cashier_history_feed(uuid,text)'::regprocedure,", names)
    ).toEqual(['fn_cashier_history_feed']);
    expect(
      changedPinnedFunctions("-- pg_get_functiondef('public.fn_cashier_history_feed(uuid)')", names)
    ).toEqual([]);
    expect(
      changedPinnedFunctions(
        "FOR fn IN SELECT unnest(ARRAY[\n    'public.fn_cashier_history_page(uuid)'] LOOP",
        names
      )
    ).toEqual(['fn_cashier_history_page']);
    expect(
      changedPinnedFunctions(
        "IF NOT has_function_privilege('authenticated', 'public.fn_cashier_history_feed(uuid)', 'EXECUTE')",
        names
      )
    ).toEqual([]);
  });

  it('every migration from 2026-11-14 that changes a pinned function is named', () => {
    const missing: string[] = [];
    for (const { version, sql, source } of migrations()) {
      const changed = changedPinnedFunctions(sql, pinned);
      if (changed.length === 0 || Object.hasOwn(READ_ONLY, version)) continue;
      if (!contract.includes(`version = '${version}'`))
        missing.push(`${source} changes ${changed.join(', ')}`);
    }
    expect(missing).toEqual([]);
  });
});
