/**
 * LAW: A LIGHTNING SETTLEMENT TAKES ITS HOST TABLE BEFORE ITS ANCHORS (2026-11-26).
 *
 * Three deadlocks in the 24 hours to 2026-11-26 21:45 UTC (23:09:10 and
 * 02:54:41 against fn_cashout_seat_occupancy, 21:29:36 against
 * fn_cash_seat_sitout) were one cycle: the cash writers take the tables row
 * and then the seat (THE TABLE BEFORE THE SEAT), while fn_lightning_settle_hand
 * took every anchor seat FOR UPDATE and only then, through the shared commit
 * core (fn_ca_commit_hand_settlement_exact_before_obligations), its host
 * tables row FOR UPDATE. Migration 20261126233138 takes the host table first,
 * in the same mode, inside step 5's BEGIN block.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261126233138_a_lightning_settlement_takes_its_host_table_before_its_ancho.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const SIG = 'public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)';
const ANCHOR_LINE = '    -- 5. THE ANCHORS, FOR UPDATE, IN SEAT ORDER, each named in the marker\n';
const TABLE_LOCK = 'PERFORM 1 FROM public.tables WHERE id = p_host_table_id FOR UPDATE;';
const stripComments = (text: string) => text.replace(/--[^\n]*/g, '');

/** Decode one E'...' literal assigned to `name` in the migration. */
function literal(name: string): string {
  const m = sql.match(new RegExp(`${name} text := E'((?:[^']|'')*)';`));
  if (!m) throw new Error(`${name} literal missing`);
  return m[1].replace(/''/g, "'").replace(/\\n/g, '\n');
}

describe('a Lightning settlement takes its host table before its anchors', () => {
  const oldText = literal('v_old');
  const newText = literal('v_new');

  it('anchors on the start of step 5 and keeps that line unchanged after the insert', () => {
    expect(oldText).toBe(`  BEGIN\n${ANCHOR_LINE}`);
    expect(newText.startsWith('  BEGIN\n')).toBe(true);
    expect(newText.endsWith(ANCHOR_LINE)).toBe(true);
    expect(sql).toContain(
      "RAISE EXCEPTION 'fn_lightning_settle_hand anchor-loop anchor was expected exactly once'"
    );
    expect(sql.match(/EXECUTE replace\(v_def, v_old, v_new\);/g)).toHaveLength(1);
  });

  it('takes the host tables row FOR UPDATE, the commit core mode, before the first anchor', () => {
    const body = stripComments(newText);
    expect(body).toContain(TABLE_LOCK);
    expect(body.indexOf(TABLE_LOCK)).toBeLessThan(newText.indexOf(ANCHOR_LINE));
    // Exactly one new lock, and never a weaker mode that the commit core would
    // later upgrade.
    expect(body.match(/FOR (UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)/g)).toEqual(['FOR UPDATE']);
  });

  it('applied to a step-5 excerpt, the table lock lands inside BEGIN and ahead of the anchor SELECT', () => {
    const excerpt =
      '  END IF;\n\n' +
      oldText +
      '    --    for this transaction. Anchors before pool slots and sessions: the\n' +
      "    --    formation barrier's own order.\n" +
      '    FOR a IN SELECT 1 LOOP\n' +
      '        INTO s FROM public.table_seats ts WHERE ts.id = a.seat_id FOR UPDATE;\n';
    expect(excerpt.split(oldText)).toHaveLength(2);
    const post = excerpt.replace(oldText, newText);
    const begin = post.indexOf('  BEGIN\n');
    const lock = post.indexOf(TABLE_LOCK);
    const seat = post.indexOf(
      'INTO s FROM public.table_seats ts WHERE ts.id = a.seat_id FOR UPDATE;'
    );
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(lock);
    expect(lock).toBeLessThan(seat);
  });

  it('keeps the grants and refuses a second application', () => {
    expect(sql).toContain("RAISE EXCEPTION 'fn_lightning_settle_hand grants changed'");
    expect(sql).toContain("position('THE HOST TABLE BEFORE ANY ANCHOR' IN v_def) > 0");
    expect(sql).toContain(`has_function_privilege('anon', '${SIG}', 'EXECUTE')`);
    expect(stripComments(sql)).not.toMatch(/\bGRANT\b|\bREVOKE\b/);
  });

  it('touches no money, seat placement or horse flag', () => {
    const code = stripComments(sql);
    expect(code).not.toMatch(/is_horse/);
    expect(code).not.toMatch(/UPDATE public\.(table_seats|union_wallets|club_members|profiles)/);
  });

  it('is one bounded transaction with a probe after the definition', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql.match(/^-- @live-proof: \(SELECT /gm)).toHaveLength(1);
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
    expect(sql.indexOf('-- @probe-for: public.fn_lightning_settle_hand')).toBeGreaterThan(
      sql.indexOf('EXECUTE replace(v_def, v_old, v_new);')
    );
  });

  it('no later migration rewrites the settlement back to anchors before its host table', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (/CREATE OR REPLACE FUNCTION public\.fn_lightning_settle_hand\s*\(/i.test(source)) {
        const code = stripComments(source);
        const lock = code.indexOf('FROM public.tables WHERE id = p_host_table_id FOR UPDATE');
        const seat = code.indexOf('WHERE ts.id = a.seat_id FOR UPDATE');
        expect(
          lock,
          `${file} redefines the settlement without the host table first`
        ).toBeGreaterThan(-1);
        expect(lock, `${file} locks an anchor before the host table`).toBeLessThan(seat);
      }
    }
  });
});
