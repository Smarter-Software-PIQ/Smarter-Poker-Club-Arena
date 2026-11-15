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
 * Limits: this runs in this repository. A World Hub migration reaches it only
 * once it is recorded in a fixture here, and a function name assembled at run
 * time (format(), concatenation) is not seen. The post-deploy contract, which
 * compares the installed bodies, remains the check for both.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const contract = readFileSync(
  resolve(ROOT, 'scripts/verification-harness/cashier-release-contract.sql'),
  'utf8'
);
const FLOOR = '20261114000000';

/**
 * Migrations that name a pinned function without changing its body, each with
 * the reason (checked below: the version exists, is detected, and the reason
 * says what it does instead).
 */
const READ_ONLY: Readonly<Record<string, string>> = {};

/** Real `WHERE version = '<v>'` lines of the contract; comments do not count. */
const named = (version: string) =>
  /^\d{14}$/.test(version) &&
  new RegExp(`^\\s*WHERE version = '${version}'\\s*$`, 'm').test(contract);

const pinned = [
  ...new Set(
    [...contract.matchAll(/'signature',\s*'public\.([a-z0-9_]+)\(/g)].map((match) => match[1])
  ),
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pinned functions whose definition this SQL creates, replaces, alters or
 * patches or drops. Schema-qualified or not, quoted or not. GRANT, REVOKE and
 * COMMENT say "ON FUNCTION" and do not change a definition; they are excluded at
 * the match. Nothing is cut out of the text first: cutting from a stray "grant"
 * in a comment to the next semicolon once hid a CREATE header (review B2).
 */
export function changedPinnedFunctions(sql: string, names: readonly string[]): string[] {
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return names.filter((name) => {
    const n = escape(name);
    const fn = `(?:"?public"?\\s*\\.\\s*)?"?${n}"?\\s*\\(`;
    const qualified = `'(?:"?public"?\\.)"?${n}"?\\(`;
    return (
      new RegExp(`(?<!\\bON\\s+)FUNCTION\\s+${fn}`, 'i').test(code) ||
      new RegExp(
        `(?:ALTER|DROP)\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:"?public"?\\s*\\.\\s*)?"?${n}"?(?![a-z0-9_])`,
        'i'
      ).test(code) ||
      new RegExp(`pg_get_functiondef\\(\\s*${qualified}`, 'i').test(code) ||
      new RegExp(`${qualified}[^']*\\)'\\s*::\\s*regprocedure`, 'i').test(code) ||
      // a signature handed to a patch loop (ARRAY['public.fn(...)', ...] LOOP);
      // privilege checks, grants and comments only read the function
      code
        .split('\n')
        .some(
          (line) =>
            new RegExp(qualified, 'i').test(line) &&
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

  it('sees unqualified and quoted names, and not a grant or a comment', () => {
    const names = ['fn_cashier_history_feed'];
    for (const sql of [
      'CREATE OR REPLACE FUNCTION fn_cashier_history_feed(p uuid)',
      'CREATE OR REPLACE FUNCTION "public"."fn_cashier_history_feed"(p uuid)',
      'ALTER FUNCTION public.fn_cashier_history_feed(uuid) SET search_path = public',
      'd := pg_get_functiondef(\'"public"."fn_cashier_history_feed"(uuid)\'::regprocedure);',
      // review B2: a stray grant or revoke before the header must not hide it
      '/* Replace the feed, then re-grant it below. */\nCREATE OR REPLACE FUNCTION public.fn_cashier_history_feed(p uuid)\n RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;',
      'REVOKE ALL ON FUNCTION public.fn_other(uuid) FROM PUBLIC; -- revoke first, then replace\nCREATE OR REPLACE FUNCTION public.fn_cashier_history_feed(p uuid)\n RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;',
      'ALTER FUNCTION public.fn_cashier_history_feed SECURITY INVOKER;',
      'DROP FUNCTION IF EXISTS public.fn_cashier_history_feed;',
    ])
      expect(changedPinnedFunctions(sql, names), sql).toEqual(names);
    for (const sql of [
      'GRANT EXECUTE ON FUNCTION public.fn_cashier_history_feed(uuid) TO authenticated;',
      'REVOKE ALL ON FUNCTION\n  public.fn_cashier_history_feed(uuid)\n  FROM anon;',
      "COMMENT ON FUNCTION public.fn_cashier_history_feed(uuid) IS 'x';",
    ])
      expect(changedPinnedFunctions(sql, names), sql).toEqual([]);
  });

  it('a version is named only by a real WHERE line, never by a comment', () => {
    expect(named('20261114171135')).toBe(true);
    expect(named('20261114')).toBe(false);
    expect(named('.*')).toBe(false);
    const commentOnly = contract.replace(
      /^(\s*)WHERE version = '20261114171135'$/m,
      "$1-- WHERE version = '20261114171135'"
    );
    expect(new RegExp(`^\\s*WHERE version = '20261114171135'\\s*$`, 'm').test(commentOnly)).toBe(
      false
    );
  });

  it('every migration from 2026-11-14 that changes a pinned function is named', () => {
    const missing: string[] = [];
    for (const { version, sql, source } of migrations()) {
      const changed = changedPinnedFunctions(sql, pinned);
      if (changed.length === 0 || Object.hasOwn(READ_ONLY, version)) continue;
      if (!named(version)) missing.push(`${source} changes ${changed.join(', ')}`);
    }
    expect(missing).toEqual([]);
  });

  it('a read-only exception names a real migration the check sees, with its reason', () => {
    const all = migrations();
    for (const [version, reason] of Object.entries(READ_ONLY)) {
      const hit = all.find((m) => m.version === version);
      expect(hit, version).toBeDefined();
      expect(changedPinnedFunctions(hit!.sql, pinned).length, version).toBeGreaterThan(0);
      expect(reason.trim().length, version).toBeGreaterThanOrEqual(20);
    }
  });

  it('each World Hub fixture is linked to the statement production recorded', () => {
    const fixtures = resolve(ROOT, 'scripts/ci/fixtures');
    const code = (sql: string) =>
      sql
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'))
        .map((line) => line.trimEnd())
        .join('\n');
    for (const file of readdirSync(fixtures).filter((f) =>
      /^world-hub-cashier-migrations-\d+\.json$/.test(f)
    ))
      for (const item of JSON.parse(readFileSync(resolve(fixtures, file), 'utf8')) as Array<{
        version: string;
        sql: string;
        recordedStatementMd5: string;
        recordedCodeMd5: string;
      }>) {
        // The repository bytes and production's recorded statement differ in
        // comments only: their non-comment lines hash the same.
        expect(createHash('md5').update(code(item.sql)).digest('hex'), item.version).toBe(
          item.recordedCodeMd5
        );
        // And the contract pins exactly that recorded statement for the version:
        // the same EXISTS subquery, from its WHERE line to the THEN or OR after it.
        const check = new RegExp(
          `WHERE version = '${item.version}'(?:(?!\\bTHEN\\b|\\bOR NOT EXISTS\\b)[\\s\\S])*`
        ).exec(contract);
        expect(check?.[0], item.version).toContain(
          `md5(statements[1]) = '${item.recordedStatementMd5}'`
        );
      }
  });
});
