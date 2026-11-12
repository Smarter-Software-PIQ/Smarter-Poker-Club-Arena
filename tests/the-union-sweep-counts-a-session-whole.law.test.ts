/**
 * THE UNION SWEEP COUNTS A SESSION WHOLE (2026-11-12)
 *
 * fn_union_integrity_sweep's agent_roster_winning signal read each wallet row
 * by its own created_at, so a session that began just before the window
 * counted its cashout or prize without the buy-in that paid for it
 * (Production Alerts row 377222: a 136.08 prize counted against no 40.00
 * buy-in). The net now pairs a pre-window debit with its in-window credit on
 * the same cash table or tournament, and nothing else from before the window.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261112214754_the_union_sweep_counts_a_session_whole.sql',
  'utf8'
);
const passage = (tag: string): string => {
  const open = `$${tag}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start + open.length, sql.indexOf(open, start + open.length));
};
const oldHead = passage('olda');
const newHead = passage('newa');
const newNet = passage('newb');

describe('the union sweep counts a session whole', () => {
  it('replaces the per-row window filter that dropped a session buy-in', () => {
    expect(oldHead).toContain('wt.created_at >= v_from\n');
    expect(newHead).not.toContain('AND wt.created_at >= v_from\n');
    expect(newHead).toContain("wt.created_at >= v_from - interval '24 hours'");
    expect(newHead).toContain('scoped AS MATERIALIZED (');
  });

  it('pulls a pre-window debit in only beside an in-window credit of the same session', () => {
    expect(newNet).toContain('WHERE s.created_at >= v_from');
    expect(newNet).toContain("OR (s.type = 'debit'");
    expect(newNet).toContain("w.player_id = s.player_id AND w.type = 'credit'");
    expect(newNet).toContain('w.created_at >= v_from');
    expect(newNet).toContain('w.table_id IS NOT DISTINCT FROM s.table_id');
    expect(newNet).toContain('w.related_entity_id = s.related_entity_id');
  });

  it('never reaches back past a cashout that closed an earlier session at the same table', () => {
    expect(newNet).toContain("c.type = 'credit' AND c.category = 'cashout'");
    expect(newNet).toContain('c.created_at > s.created_at AND c.created_at < v_from');
  });

  it('never counts a pre-window credit', () => {
    // The only pre-window rows admitted are debits.
    const admitted = newNet.slice(newNet.indexOf('OR ('), newNet.indexOf('GROUP BY'));
    expect(admitted.startsWith("OR (s.type = 'debit'")).toBe(true);
  });

  it('installs only over the pinned preimage and reads back the derived postimage', () => {
    expect(sql).toContain("'2d206e82cdc6c2459621ace94808eae6'");
    expect(sql).toContain("'93765162c4d5e216947137b27862446f'");
    expect(sql).toContain('pg_get_functiondef(v_oid) IS DISTINCT FROM v_new');
    expect(sql).toContain('fn_ca_break_window_refuses_migrations(now())');
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('treats a horse identically: the net reads no horse flag', () => {
    expect(newHead + newNet).not.toMatch(/is_horse/);
  });
});
