import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-05: every Midway Free Buy since 2026-11-03 had zero entries because
// the entry-ticket lookups judged its promo-funded split (prize -1, bounty 1)
// as an impossible ticket price and refused before their no-ticket exit.
const MIGRATION = 'supabase/migrations/20261105073723_a_free_buy_entry_has_no_ticket_to_check.sql';

describe('a Free Buy entry has no ticket to check', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('patches both entry-ticket lookups', () => {
    expect(sql).toContain("'public.fn_ca_find_tournament_entry_ticket_for(uuid,uuid)'");
    expect(sql).toContain("'public.fn_horse_tournament_entry_ticket_hints(uuid)'");
  });

  it('exits only for a real Free Buy that charges nothing, before the price check', () => {
    expect(sql).toContain("E'  IF COALESCE(v_t.free_buy,false)\\n'");
    expect(sql).toContain(
      'round(COALESCE(v_t.buy_in_amount,0)+COALESCE(v_t.buy_in_fee,0),2)=0 THEN'
    );
    expect(sql).toMatch(/\|\| v_anchor\);/);
  });

  it('refuses unless each anchor appears exactly once', () => {
    expect(sql).toMatch(/<> 1 THEN\s+RAISE EXCEPTION/);
  });
});
