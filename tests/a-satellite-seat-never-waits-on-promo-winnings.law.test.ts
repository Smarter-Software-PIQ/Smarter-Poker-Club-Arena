/**
 * A SATELLITE SEAT NEVER WAITS ON PROMO WINNINGS (2026-11-19)
 *
 * Every seat a satellite awards writes a tournament_refund_entitlements row,
 * whose trigger ran fn_ca_promo_profit_finish_entry_fee, which re-evaluated the
 * seat holder's whole promo winnings fee state (fn_ca_promo_profit_settle)
 * inside the satellite's settlement transaction. On 2026-11-18 23:02 UTC two
 * satellites with 20 and 19 qualifiers, all holding promo grants, needed 10.4 s
 * and 9.7 s of that evaluation alone: the settlement could not fit its 8 s
 * statement and was refused about 500 times in 68 minutes, holding the finish
 * lane and both events' lanes for 8 s each time.
 *
 * Owner rulings: promo chips never cause payout issues with tournaments
 * (2026-11-17); promo progress is checked hourly, never inline (2026-11-18).
 * The settle only ever RELEASES winnings, so leaving it to the hourly sweep
 * and the cash-out path can delay a release and can never let locked promo out.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(__dirname, '..', 'supabase/migrations');
const FN = 'fn_ca_promo_profit_finish_entry_fee';

/** The body of the last migration that defines the function. */
function latestBody(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(migrations, file), 'utf8');
    const at = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
    if (at < 0) continue;
    const open = /\$([a-z_]*)\$/i.exec(sql.slice(at));
    if (!open) continue;
    const start = at + open.index + open[0].length;
    const end = sql.indexOf(open[0], start);
    found = { file, body: sql.slice(start, end) };
  }
  if (!found) throw new Error(`${FN} is not defined by any migration`);
  return found;
}

describe('a satellite seat never waits on promo winnings', () => {
  const { body } = latestBody();
  const seatReturn = body.search(/entitlement_kind\s*=\s*'satellite_seat'[\s\S]*?RETURN;/);
  const settle = body.indexOf('fn_ca_promo_profit_settle(');

  it('still consumes the entry fee of every charge first', () => {
    const consume = body.indexOf('fn_ca_promo_profit_consume_entry_fee(p_charge)');
    expect(consume).toBeGreaterThan(-1);
    expect(seatReturn).toBeGreaterThan(consume);
  });

  it('returns for a satellite seat before any winnings settle runs', () => {
    expect(seatReturn).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(seatReturn);
  });

  it('finds the seat by its own entitlement row and not by a session setting', () => {
    expect(body).toMatch(/tournament_refund_entitlements[\s\S]*source_ledger_id\s*=\s*p_charge/);
    expect(body).not.toMatch(/current_setting\(/);
  });
});
