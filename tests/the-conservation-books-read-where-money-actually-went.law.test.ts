import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-05: 113 "tournament kept money" alerts were open on events whose
// ledger and escrow balanced. The detector did not read owner retirement
// transfers, the owner bounty guarantee correction, or a ticket redeemed into
// an event other than its satellite's target. Both readings of the books (the
// scalar and the one-pass set function) must carry the same three terms.
const MIGRATION =
  'supabase/migrations/20261105130850_the_conservation_books_read_owner_transfers_and_where_a_tick.sql';

describe('the conservation books read where the money actually went', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('patches both the scalar and the one-pass set function', () => {
    expect(sql).toContain("'public.fn_tournament_conservation_delta(uuid)'::regprocedure");
    expect(sql).toContain(
      "'public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure"
    );
    expect(sql.match(/EXECUTE v_new;/g)).toHaveLength(2);
  });

  it('reads the owner-directed returns to the house in both', () => {
    expect(sql.match(/owner-retirement-pool:%/g)?.length).toBe(2);
    expect(sql.match(/owner_bounty_guarantee_correction/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('credits an admission leg where it landed, and not again at the target', () => {
    expect(sql.match(/tournament_entry_ticket_admission/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("ad.created_at = k.redeemed_at AND ad.category = ''ticket_redeem''");
    expect(sql).toContain('+ m.ticket_in\\n    - m.owner_out');
    expect(sql).toContain('+ COALESCE(ti.amount, 0) - COALESCE(oo.amount, 0), 2) END AS delta');
  });

  it('refuses unless each anchor appears exactly once, and proves the named events balance', () => {
    expect(sql.match(/<> 1 THEN\s+RAISE EXCEPTION/g)?.length).toBe(7);
    expect(sql).toContain("RAISE EXCEPTION 'conservation reading for % is scalar % set %'");
  });

  it('moves no money and leaves any alert that still reads wrong open', () => {
    const body = sql.replace(/--[^\n]*/g, '');
    expect(body).not.toMatch(/chip_balance|INSERT INTO|fn_credit_and_log|fn_add_chips/);
    expect(body).toContain('<= 0.05;');
  });
});
