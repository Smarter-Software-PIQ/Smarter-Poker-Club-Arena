import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CASH_TABLE_MIN_BB } from '../src/config/cashGames';

/**
 * Dan 2026-11-08: "MAKE THE MINIMUM BUY INS 50 BB FOR ANY AND ALL CASH GAMES."
 * Asked whether Lightning keeps 100 BB, he chose "Every game exactly 50 BB".
 *
 * The database is the authority, because atomic_table_buyin enforces the row:
 *   - fn_cash_template_defaults writes 50 for every template;
 *   - zz_cash_game_floor_from_template forces the template's minimum onto every
 *     game snapshot write, so no override, edit or script carries another;
 *   - fn_update_managed_game derives a table's minimum as bb * 50.
 * The screens print the number and never offer another one.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();
const latestDefining = (fn: string) => {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`);
  const file = [...migrations].reverse().find((f) => re.test(read(`supabase/migrations/${f}`)));
  if (!file) throw new Error(`no migration defines ${fn}`);
  const sql = read(`supabase/migrations/${file}`);
  const at = sql.search(re);
  return sql.slice(at, sql.indexOf('$function$;', at));
};

describe('every cash game minimum buy-in is exactly 50 BB', () => {
  it('the screens use one constant, and it is 50', () => {
    expect(CASH_TABLE_MIN_BB).toBe(50);
  });

  it('the template writes 50 for every template, Classic and Lightning alike', () => {
    const def = latestDefining('fn_cash_template_defaults');
    expect(def).toMatch(/'min_buyin_bb',50,/);
    expect(def).not.toMatch(/'min_buyin_bb',CASE/);
  });

  it('every snapshot write takes the minimum from the template', () => {
    const def = latestDefining('fn_cash_game_floor_from_template');
    expect(def).toMatch(/'min_buyin_bb', v_def->'min_buyin_bb'/);
  });

  it('a managed table derives its minimum from its big blind', () => {
    const sql = read(
      'supabase/migrations/20261108210837_every_cash_game_minimum_buy_in_is_50bb.sql'
    );
    expect(sql).toContain('v_min := round(v_bb * 50, 2)');
    expect(sql).toContain("RAISE EXCEPTION 'unexpected fn_update_managed_game preimage'");
  });

  it('no screen offers a minimum buy-in control', () => {
    const flow = read('src/components/cash/CashGameCreateFlow.tsx');
    expect(flow).not.toMatch(/label="Minimum Buy In"/);
    expect(flow).toContain('data-testid="cash-create-min-buy-in"');
    const manage = read('src/pages/GameManagementPage.tsx');
    expect(manage).not.toMatch(/setMinBuyIn/);
    expect(manage).toContain('Number(bigBlind) * CASH_TABLE_MIN_BB');
    const club = read('src/pages/ClubDetailPage.tsx');
    expect(club).toContain('Minimum Buy-In: {CASH_TABLE_MIN_BB} BB');
  });
});
