/**
 * ===========================================================================
 *  LAW: A HAND RECORDS WHICH HORSE OPTION RECEIPTS FIRED IN IT, CHEAPLY AND
 *       WITH NO CARD, AND NO BROWSER CAN READ IT
 * ===========================================================================
 *
 * Migration 20261126004403 creates public.ca_horse_hand_receipts
 * (hand_id, receipt, decisions): one row per (hand, Horse option receipt) for
 * hands a person was dealt into, written by the engine after the hand's own
 * save (server/src/services/HorseHandReceipts.ts) and read by
 * scripts/ops/person-vs-horse-results.mjs --by-option-receipt. The Hold'em
 * owner released it on conditions; this law pins the ones the database holds:
 *
 *   1. THE MIGRATION IS CHEAP AND LOCKS NO HOT TABLE. One transaction, one new
 *      empty table and nothing else: no foreign key (a reference to
 *      hand_history takes SHARE ROW EXCLUSIVE on it), no trigger, function,
 *      index, view or ALTER of any existing relation, no install-window
 *      header, short lock and statement timeouts. It names no hot relation in
 *      a statement at all.
 *   2. NO CARD OF ANY KIND CAN BE STORED. `receipt` is exactly
 *      `<option>:<before>><after>` over a closed set of action words; the
 *      CHECK refuses anything else. Every text the engine can produce passes
 *      it; a card, board, strength, equity or amount does not.
 *   3. NO BROWSER ACCESS. RLS on with no policy; PUBLIC, anon and
 *      authenticated hold nothing; service_role inserts and reads only. No
 *      client code, edge function, view or publication names the table.
 *   4. RETENTION NEEDS NO PRUNER. The engine writes rows only for hands with
 *      a person (hand_history keeps those for good), so the migration adds no
 *      cron and no delete path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HAND_OPTION_RECEIPT_KINDS,
  HAND_OPTION_RECEIPT_OPTIONS,
  HAND_OPTION_RECEIPT_ROW,
} from '../server/src/engine/HorseHandOptionReceipts';

const ROOT = resolve(__dirname, '..');
const TABLE = 'ca_horse_hand_receipts';
const MIGRATION =
  'supabase/migrations/20261126004403_a_hand_records_which_horse_option_receipts_fired_in_it.sql';
const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
/** The statements, without comment lines. */
const code = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const header = sql
  .split('\n')
  .filter((l) => l.trimStart().startsWith('--'))
  .join('\n');

describe('LAW: a hand records which Horse option receipts fired in it', () => {
  it('is one transaction that creates one empty table and touches nothing else', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code.trim().startsWith('BEGIN;')).toBe(true);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
    expect(code).toContain("SET LOCAL lock_timeout = '1s';");
    expect(code).toContain("SET LOCAL statement_timeout = '8s';");
    // The only DDL: CREATE TABLE, COMMENT ON TABLE, ENABLE RLS on the new table.
    expect(code.match(/\bCREATE\s+\w+/gi)).toEqual(['CREATE TABLE']);
    expect(code).toMatch(/CREATE TABLE public\.ca_horse_hand_receipts \(/);
    expect(code.match(/\bALTER\s+TABLE\s+[\w.]+/gi)).toEqual([
      'ALTER TABLE public.ca_horse_hand_receipts',
    ]);
    expect(code).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bLOCK\s+TABLE\b|\bCREATE\s+INDEX\b/i);
    expect(code).not.toMatch(/\bTRIGGER\b|\bFUNCTION\b|\bVIEW\b|\bPUBLICATION\b|\bcron\./i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+\w|\bDELETE\s+FROM\b/i);
    // No foreign key, and no hot relation is named by any statement (string literals, which are the table
    // comment and the verify block's messages, are not statements).
    const statements = code.replace(/'(?:[^']|'')*'/g, "''");
    expect(statements).not.toMatch(/\bREFERENCES\b|\bFOREIGN\s+KEY\b/i);
    for (const hot of [
      'hand_history',
      'clubs',
      'tables',
      'tournaments',
      'profiles',
      'ca_hand_facts',
    ])
      expect(statements, hot).not.toMatch(
        new RegExp(`\\bpublic\\.${hot}\\b|\\b${hot}\\s*\\(`, 'i')
      );
    // It needs no install window, so it must not ask for one (a queued file would wait a day for nothing).
    expect(sql).not.toMatch(/^--\s*@install-window:/m);
    expect(sql).not.toMatch(/^--\s*@locks:/m);
    // The live proof the repository's gates read after install.
    expect(header).toMatch(/^-- @live-proof: .*ca_horse_hand_receipts/m);
  });

  it('has exactly the agreed shape: (hand_id uuid, receipt text, decisions smallint), keyed by both', () => {
    const body = code.slice(
      code.indexOf('CREATE TABLE'),
      code.indexOf(');', code.indexOf('CREATE TABLE'))
    );
    expect(body).toMatch(/\bhand_id\s+uuid\s+NOT NULL,/);
    expect(body).toMatch(/\breceipt\s+text\s+NOT NULL,/);
    expect(body).toMatch(/\bdecisions\s+smallint\s+NOT NULL,/);
    expect(body).toMatch(/PRIMARY KEY \(hand_id, receipt\)/);
    expect(body).toMatch(/CHECK \(decisions BETWEEN 1 AND 999\)/);
    // No fourth column: nowhere to put anything else.
    const columns = body
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l && !/^(CONSTRAINT|receipt ~|\))/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    expect(columns).toEqual(['hand_id', 'receipt', 'decisions']);
  });

  it('refuses any receipt that is not an option name and two action words: no card can be stored', () => {
    const m = /receipt ~ '([^']+)'/.exec(code);
    expect(m).not.toBeNull();
    const check = new RegExp(m![1]);
    expect(m![1]).toBe(
      '^[A-Za-z][A-Za-z0-9]{0,63}:(none|fold|check|call|bet|raise|all_in)>(fold|check|call|bet|raise|all_in)$'
    );
    // Every text the engine can produce passes, and the engine's own pattern is the stricter one.
    for (const option of HAND_OPTION_RECEIPT_OPTIONS)
      for (const before of ['none', ...HAND_OPTION_RECEIPT_KINDS])
        for (const after of HAND_OPTION_RECEIPT_KINDS) {
          const text = `${option}:${before}>${after}`;
          expect(HAND_OPTION_RECEIPT_ROW.test(text), text).toBe(true);
          expect(check.test(text), text).toBe(true);
        }
    for (const bad of [
      'cashDefenceTrimColdCalls:AsKd>fold',
      'cashDefenceTrimColdCalls:call>AsKd',
      'cashDefenceTrimColdCalls:call>fold AsKd',
      'cashDefenceTrimColdCalls:call>fold:Td9d8d',
      'cashDefenceTrimColdCalls:call>fold:0.62',
      'cashDefenceTrimColdCalls:call>fold\nAs',
      'cashDefenceTrimColdCalls:call>raise 40',
      'cashDefenceTrimColdCalls:top_pair>fold',
      'cashDefenceTrimColdCalls:call>none',
      'cashDefenceTrimColdCalls:call',
      'call>fold',
      'As Kd',
      '',
    ]) {
      expect(check.test(bad), JSON.stringify(bad)).toBe(false);
      expect(HAND_OPTION_RECEIPT_ROW.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is service-role only: RLS, no policy, no client grant, insert and read and nothing more', () => {
    expect(code).toContain('ALTER TABLE public.ca_horse_hand_receipts ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain(
      'REVOKE ALL ON TABLE public.ca_horse_hand_receipts FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(code.match(/\bGRANT\b[^;]*;/gi)).toEqual([
      'GRANT SELECT, INSERT ON TABLE public.ca_horse_hand_receipts TO service_role;',
    ]);
    expect(code).not.toMatch(/CREATE\s+POLICY/i);
    // The migration verifies its own grants before it commits.
    expect(code).toMatch(
      /RAISE EXCEPTION 'ca_horse_hand_receipts grants are not service-role insert and read only'/
    );
    expect(code).toMatch(/RAISE EXCEPTION 'ca_horse_hand_receipts must carry no foreign key'/);
  });

  it('is declared in a schema manifest fragment, and no later migration reopens it', () => {
    const fragment = JSON.parse(
      readFileSync(
        resolve(
          ROOT,
          'scripts/ci/schema-manifest.d/a-hand-records-which-horse-option-receipts-fired-in-it.json'
        ),
        'utf8'
      )
    ) as { tables: string[]; functions: string[]; columns: Record<string, string[]> };
    expect(fragment.tables).toEqual([TABLE]);
    expect(fragment.functions).toEqual([]);
    expect(fragment.columns).toEqual({ [TABLE]: ['hand_id', 'receipt', 'decisions'] });
    const others = readdirSync(resolve(ROOT, 'supabase/migrations')).filter(
      (f) => f.endsWith('.sql') && !MIGRATION.endsWith(f)
    );
    const reopened = others.filter((f) =>
      readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8').includes(TABLE)
    );
    // A later migration that grants a client access, adds a policy or a foreign key must change this law.
    expect(reopened).toEqual([]);
  });

  it('is named by no client code, edge function or other server path', () => {
    const r = spawnSync(
      'git',
      ['grep', '-l', '-F', TABLE, '--', 'src', 'supabase/functions', 'server/src', 'scripts/ops'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    if (r.error) throw r.error;
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep: ${r.stderr}`);
    const files = r.stdout
      .split('\n')
      .filter(Boolean)
      .filter((f) => !/\.test\.ts$/.test(f))
      .sort();
    expect(files).toEqual([
      // the read-only results report (one EXISTS probe; the receipt text is never selected)
      'scripts/ops/person-vs-horse-results-lib.mjs',
      // the definition of a receipt (comment only)
      'server/src/engine/HorseHandOptionReceipts.ts',
      // the one writer
      'server/src/services/HorseHandReceipts.ts',
      // the hand save that calls the writer (comment only)
      'server/src/services/supabase/handHistory.ts',
    ]);
    const writer = readFileSync(resolve(ROOT, 'server/src/services/HorseHandReceipts.ts'), 'utf8');
    expect(writer).toContain("export const HORSE_HAND_RECEIPTS_TABLE = 'ca_horse_hand_receipts';");
    expect(writer).not.toMatch(/\.delete\(|\.update\(/);
  });
});
