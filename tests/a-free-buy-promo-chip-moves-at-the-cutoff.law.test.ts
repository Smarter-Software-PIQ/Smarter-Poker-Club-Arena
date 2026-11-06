import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-05 14:24 CT: "Issuing a ticket moves no chips." "NO chips
// credited to the prize pool until registration AND every rebuy/add-on window
// has closed." Guaranteed: P = max(G, C), U = max(0, G - C). Non-guaranteed:
// V = 1 per first-entry ticket, P = V + C. The 2026-11-06 Morning Free Buy
// posted 189 promo chips during registration and returned all 189 at its
// cutoff; this law keeps the prize-pool promo part out of sign-up for good.
const MIGRATION =
  'supabase/migrations/20261106195136_a_free_buy_promo_chip_moves_at_cutoff_not_signup.sql';
const CASES = 'scripts/dev/free-buy-cutoff/05_cases.sql';

describe('a Free Buy promo chip moves at the cutoff, not at sign-up', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('the human and horse registration doors book no prize-pool promo money', () => {
    expect(sql).toContain(
      "'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'",
    );
    expect(sql).toContain(
      "'public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'",
    );
    expect(sql).toContain('v_split.bounty:=0; v_split.prize:=0; -- cutoff');
    expect(sql).toContain('v_split.bounty:=0.50; v_split.prize:=0; -- cutoff');
    expect(sql).toMatch(/expected exactly one regular and one mystery Free Buy split to amend/);
  });

  it('the sign-up leg carries only the bounty part; regular and all-in-or-fold post nothing', () => {
    const head = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head'),
      sql.indexOf('CREATE FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked'),
    );
    expect(head).toContain("v_bounty:=CASE v_format WHEN 'pko' THEN 1 WHEN 'mystery' THEN 0.50 ELSE 0 END;");
    expect(head).toContain('v_amount:=round(v_bounty+v_prize,2);');
    expect(head).toMatch(/IF v_amount<=0 THEN[\s\S]*?RETURN 0;/);
    // A returned entry with nothing posted still gets its ticket back.
    expect(head).toMatch(/IF funded.id IS NULL THEN[\s\S]*?free_buy_ticket_restore/);
  });

  it('the cutoff funds once, inside the single finalization authority, before the guarantee core', () => {
    expect(sql).toContain("':free_buy_cutoff_funding'");
    expect(sql).toContain("'house_due'");
    expect(sql).toMatch(
      /PERFORM public\.fn_ca_fund_free_buy_at_cutoff_locked\(p_tournament_id\);\n\s*PERFORM public\.fn_ca_return_excess_guarantee_promo_locked\(p_tournament_id\);/,
    );
    // Booked as promo money so the escrow shadow and the funding read count it.
    expect(sql).toContain("'kind', 'midway_free_buy_promo_head', 'stage', 'cutoff'");
    expect(sql).toContain("('fn_ca_fund_free_buy_at_cutoff_locked', 'approved'");
  });

  it('the native proof carries the owner acceptance table', () => {
    const cases = readFileSync(CASES, 'utf8');
    for (const row of [
      "('G500 T250 C160', pg_temp.run('aiof', 500, 250, 160), 500, 340)",
      "('G500 T250 C0',   pg_temp.run('aiof', 500, 250, 0),   500, 500)",
      "('G500 T250 C500', pg_temp.run('regular', 500, 250, 500), 500, 0)",
      "('G500 T250 C650', pg_temp.run('regular', 500, 250, 650), 650, 0)",
      "('NG T250 C160', pg_temp.run('regular', 0, 250, 160), 410, 250)",
      "('NG T250 C0',   pg_temp.run('regular', 0, 250, 0),   250, 250)",
    ]) {
      expect(cases).toContain(row);
    }
  });
});
