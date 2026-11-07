/**
 * A UNION'S OWN CLUB IS HOUSE RAKE, NOT RAKEBACK (2026-11-07).
 *
 * Round 1 of the union close keeps all rake earned at a union's own club
 * (clubs.is_union) as house rake. On 2026-11-02 a resumed split wrote six
 * rakeback periods there anyway (54.95 on 78.50 of rake - exactly the round 1
 * house_rake already in the union bank), which would have paid the same rake
 * twice and which blocked Midway's weekly close. Pinned here:
 *   1. both rakeback writers refuse a union's own club before computing;
 *   2. the close's split-advance never resumes parts for one;
 *   3. the paying calculator, split_check and split_write are untouched
 *      (own-agent preparation records their md5s);
 *   4. the six are retired, not paid, each re-checked against house_rake.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261107195146_a_union_own_club_is_house_rake_not_rakeback.sql'),
  'utf8'
);
const code = sql.replace(/--[^\n]*/g, '');

describe("a union's own club is house rake, not rakeback", () => {
  it('both writers refuse a union own club', () => {
    // The guard is one E'' string (it carries a -- comment for the installed
    // body), so it is read from the raw file, not the comment-stripped code.
    expect(sql).toContain('u.is_union IS TRUE) THEN');
    expect(sql).toContain("RAISE EXCEPTION ''rakeback_for_union_own_club_refused''");
    expect(code).toMatch(/EXECUTE replace\(dp, a_p,/);
    expect(code).toMatch(/EXECUTE replace\(ds, a_s,/);
  });

  it('the split advance skips a union own club', () => {
    expect(code).toContain('c.is_union IS TRUE)');
    expect(code).toMatch(/EXECUTE replace\(da, a_a, r_a\)/);
  });

  it('never touches the paying calculator, split_check or split_write', () => {
    expect(code).not.toMatch(/fn_calculate_cash_rakeback_periods|fn_rakeback_split_write|fn_rakeback_split_check/);
  });

  it('retires the six as closed, never pays them, and checks them against house_rake', () => {
    expect(code).toContain("SET status='closed'");
    expect(code).toContain("v_house IS DISTINCT FROM 78.5");
    expect(code).toContain('v_sum IS DISTINCT FROM 54.95');
    expect(code).not.toMatch(/INSERT INTO public\.(chip_ledger|rakeback_period_payouts|wallet_transactions)/i);
    expect(code).not.toMatch(/fn_settle|union_wallets\s+SET/i);
  });

  it('pins every preimage and postimage', () => {
    for (const h of [
      '34534e8ec5452e854db21fb4e7b4bc3a', '70340fa2112a400cb3dd2a48bba9c98f', 'bb03eb0985cf5aa9b6c3704cf0b33131',
      'ab0d968bb5228ca44cf2a5d703aeb925', 'c588b50d35036fc2be1fecbbe5514324', '2228aae0a157fe6821287f4128918b25',
    ])
      expect(code).toContain(`'${h}'`);
  });
});
