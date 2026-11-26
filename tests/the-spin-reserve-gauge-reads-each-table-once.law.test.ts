/**
 * LAW - THE SPIN RESERVE GAUGE READS EACH TABLE ONCE
 *
 * v_spin_reserve_health returns a row per spin reserve pool (about 4,000) and
 * feeds the spin-sweep alarm and the operator monitor. Its alarm counters were
 * correlated subqueries filtered on fn_spin_reserve_owner(club_id) = p.club_id,
 * which no index can serve, so every pool re-read the last day of spins and
 * ledger adjustments. It timed out 93 times in a day and the alarm it feeds
 * did not run. Migration 20261126195422 groups each table once by owner and
 * joins the result to the pools, with the same columns in the same order.
 *
 * This law reads the newest migration that defines the view and keeps it in
 * that shape, so a later edit cannot put the per-pool subqueries back.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const strip = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const DEFINES = /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+public\.v_spin_reserve_health\s+AS/i;

const definers = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => DEFINES.test(strip(readFileSync(join(MIGRATIONS, f), 'utf8'))));
const NEWEST = definers[definers.length - 1];
const newestSql = strip(readFileSync(join(MIGRATIONS, NEWEST), 'utf8'));

// The view statement runs from CREATE ... VIEW to the statement's own
// terminator; the body has no semicolon of its own.
const start = newestSql.search(DEFINES);
const view = newestSql.slice(start, newestSql.indexOf(';', start));

const COLUMNS = [
  'club_id',
  'club_name',
  'balance',
  'seeded_amount',
  'highest_stake',
  'ceiling_amount',
  'spin_count',
  'total_deposited',
  'total_drawn',
  'need_for_100x',
  'can_draw_100x',
  'is_thin',
  'shortfall_events',
  'unbooked_24h',
  'null_multiplier_24h',
  'fee_violations_24h',
];

describe('LAW: the spin reserve gauge reads each table once', () => {
  it('the newest definition is the grouped one or a later one', () => {
    expect(NEWEST >= '20261126195422_the_spin_reserve_gauge_reads_each_table_once.sql').toBe(true);
  });

  it('no counter filters a whole table by owner per pool', () => {
    expect(view).not.toMatch(/fn_spin_reserve_owner\s*\([^)]*\)\s*=\s*p\.club_id/i);
    expect(view).not.toMatch(/p\.club_id\s*=\s*fn_spin_reserve_owner\s*\(/i);
  });

  it('the ledger and the tournaments are each grouped by owner once', () => {
    expect(view).toMatch(
      /FROM\s+spin_reserve_ledger\s+l\b[\s\S]*?GROUP BY\s*\(?\s*fn_spin_reserve_owner\(l\.club_id\)/i
    );
    expect(view).toMatch(
      /FROM\s+tournaments\s+t\b[\s\S]*?GROUP BY\s*\(?\s*fn_spin_reserve_owner\(t\.club_id\)/i
    );
  });

  it('every reader still gets the same columns in the same order', () => {
    const selectList = view.slice(
      view.search(/\bSELECT\s+p\.club_id\b/i),
      view.search(/\bFROM\s+spin_bonus_pools\s+p\b/i)
    );
    // Split on the commas between items, not those inside parentheses.
    const items: string[] = [];
    let depth = 0;
    let item = '';
    for (const ch of selectList.replace(/^\s*SELECT\s+/i, '')) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        items.push(item);
        item = '';
      } else item += ch;
    }
    items.push(item);
    // An item's output name is its alias, or the column it names.
    const named = items.map((i) => i.trim().match(/([a-z_0-9]+)$/i)?.[1]);
    expect(named).toEqual(COLUMNS);
  });

  it('the meanings of the counters are kept', () => {
    expect(view).toMatch(/note\s+ILIKE\s+'%SHORTFALL%'/i);
    expect(view).toContain('COALESCE(t.buy_in_fee, 0::numeric) <> 0::numeric');
    expect(view).toContain('COALESCE(t.buy_in_fee, 0::numeric) = 0::numeric');
    expect(view).toContain('COALESCE(t.spin_multiplier, 0::numeric) <= 0::numeric');
    expect(view.match(/now\(\)\s*-\s*'24:00:00'::interval/g)?.length).toBe(2);
  });

  it('only the service role can read it, as the invoker', () => {
    expect(newestSql).toMatch(
      /ALTER VIEW public\.v_spin_reserve_health SET \(security_invoker = true\);/
    );
    expect(newestSql).toMatch(
      /REVOKE ALL ON public\.v_spin_reserve_health FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(newestSql).toMatch(/GRANT SELECT ON public\.v_spin_reserve_health TO service_role;/);
    expect(newestSql).not.toMatch(
      /GRANT[^;]*v_spin_reserve_health[^;]*TO[^;]*\b(anon|authenticated)\b/i
    );
  });
});
