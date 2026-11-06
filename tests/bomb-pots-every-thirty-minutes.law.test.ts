import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bombCadenceLabel, type CashBombTrigger } from '../src/config/cashGames';

/**
 * Owner direction 2026-11-06: "FOR BOMB POTS, LETS CHANGE IT SO THE SPINNING
 * WHEEL ONLY APPEARS EVERY 30 MINUTES. SO 2 BOMB POTS AN HOUR."
 */
const sql = readFileSync(
  'supabase/migrations/20261106202537_bomb_pots_every_thirty_minutes.sql',
  'utf8'
);
const patches = JSON.parse(sql.split('$patches$')[1]) as Array<{
  fn: string;
  md5: string;
  edits: Array<[string, string]>;
}>;

describe('bomb pots run every thirty minutes (owner 2026-11-06)', () => {
  it('prints the thirty minute promise from the stored token', () => {
    const cadence: CashBombTrigger = 'timed_30m';
    expect(bombCadenceLabel(cadence)).toBe('Every 30 Minutes');
    expect(bombCadenceLabel(cadence, true)).toBe('Every 30 Min');
  });

  it('changes the template, creator validation, current-table and new-table owners together', () => {
    expect(patches.map((p) => p.fn)).toEqual([
      'public.fn_cash_template_defaults(text,text)',
      'public.fn_cash_game_create_impl_20260905(uuid,text,text,numeric,numeric,integer,jsonb,text,boolean)',
      'public.fn_cash_cluster_open_table(uuid,text,integer,text,uuid)',
      'public.fn_cash_apply_ruleset(uuid)',
    ]);
    for (const patch of patches) {
      expect(patch.md5).toMatch(/^[a-f0-9]{32}$/);
      expect(patch.edits.some(([, next]) => next.includes('timed_30m'))).toBe(true);
      if (/apply_ruleset|open_table/.test(patch.fn)) {
        expect(
          patch.edits.some(([, next]) =>
            next.includes("WHEN v_bomb_trigger = 'timed_30m' THEN 1800")
          )
        ).toBe(true);
      }
    }
    // Every non-Classic template defaults to thirty minutes; Classic keeps no bombs.
    expect(patches[0].edits[0][1]).toBe("CASE WHEN t='classic' THEN NULL ELSE 'timed_30m' END");
  });

  it('moves every open bomb game and its live tables without touching scheduler state or money', () => {
    expect(sql).toContain('g.closed_at IS NULL');
    expect(sql).toContain("coalesce(c.lifecycle_status,'')<>'retired'");
    expect(sql).toContain("t.lifecycle<>'closed'");
    expect(sql).toContain('bomb_pot_interval_seconds=1800');
    expect(sql).toContain('BOMB_30_SOURCE_CHANGED');
    expect(sql).toContain('BOMB_30_PROJECTION_FAILED');
    expect(sql).not.toMatch(
      /SET\s+(?:bomb_pot_sched_state|bomb_pot_next_due_at|stack|chip_balance)/i
    );
    expect(sql).not.toMatch(/variant IN \('plo4'/);
  });
});
