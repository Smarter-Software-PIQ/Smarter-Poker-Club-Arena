/**
 * A SEAT OCCUPANCY IS RECORDED WHEN IT ENDS (2026-11-18, incident d2d79c4f).
 *
 * table_seats rows are reused, so a reader that asks the live chair who sat
 * there during a past hand can be answered by the next occupant, or by no one.
 * These cases pin the source record and the readers that rely on it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = join(resolve(__dirname, '../..'), 'supabase/migrations');
const sql = readFileSync(join(DIR, '20261118190500_a_seat_occupancy_is_recorded_when_it_ends.sql'), 'utf8');
const body = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('a seat occupancy is recorded when it ends', () => {
  it('records every ended cash occupancy, zero stacks included', () => {
    const writer = body('smarter_private.fn_record_ended_seat_occupancy');
    expect(writer).toContain('INSERT INTO smarter_private.cash_seat_occupancy_history');
    expect(writer).not.toMatch(/stack\s*<=\s*0/);
    expect(writer).toContain("t.tournament_id IS NOT NULL");
    expect(writer).toContain("c.asset = 'diamonds'");
    expect(sql).toMatch(/AFTER UPDATE OF user_id, occupancy_id, left_at ON public\.table_seats/);
    expect(sql).toMatch(/AFTER DELETE ON public\.table_seats/);
  });

  it('keeps the history immutable outside the retention prune', () => {
    expect(sql).toContain("RAISE EXCEPTION 'cash_seat_occupancy_history_is_immutable'");
    expect(sql).toContain('-- periodic-work: retention only.');
  });

  it('the dealt-chair evidence reads the exact stint before any receipt or exit', () => {
    const reader = body('smarter_private.cash_hand_earning_club_evidence');
    const order = ['cash_hand_chair_clubs', 'cash_seat_occupancy_history', 'v_receipts IS NOT NULL', 'ca_seat_stack_exits']
      .map((m) => reader.indexOf(m));
    order.forEach((i) => expect(i).toBeGreaterThan(0));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(reader).toContain('o.joined_at = v_join');
  });

  it('union rake attribution asks the dealt-chair evidence before the live chair', () => {
    const attr = body('public.fn_ca_attribute_union_rake');
    const evidence = attr.indexOf('smarter_private.cash_hand_earning_club_evidence(c.hand_id, c.table_id, c.user_id)');
    expect(evidence).toBeGreaterThan(0);
    expect(evidence).toBeLessThan(attr.indexOf('FROM public.table_seats s'));
  });

  it('the DDL law refuses a redefinition that drops any of it', () => {
    const law = body('smarter_private.fn_cash_rake_provenance_law_guard');
    for (const name of ['public.fn_cash_earning_club', 'public.fn_cash_capture_hand_manifest',
      'public.fn_ca_attribute_union_rake', 'smarter_private.fn_record_ended_seat_occupancy',
      'smarter_private.cash_hand_earning_club_evidence']) {
      expect(law).toContain(`'${name}'`);
    }
  });
});
