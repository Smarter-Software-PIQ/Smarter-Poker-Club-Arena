/**
 * A PROMO WINNINGS CREDIT NEVER SETTLES PROMO PROGRESS INSIDE A PAYOUT
 * (2026-11-19, incident 075013fd, lane E3)
 *
 * fn_ca_promo_profit_credit_owned (every prize, bounty, cash win, BBJ and stake
 * refund of a promo holder) ran fn_ca_promo_profit_settle before deciding
 * whether the credit is restricted. Whenever the holder's hourly snapshot was
 * not current that settle recomputed the whole fee history (production hourly
 * sweep: 1.1 s mean, 15.6 s max per account) while the payout held the event's
 * terminal lane. 20261119002717 had also put the settle back on every paid
 * entry fee that #11329 (20261119001629) took it off.
 *
 * Owner rulings: promo chips never cause payout issues with tournaments or cash
 * games (2026-11-17); promo progress is updated once per hour and checked at
 * the cashier on a cash-out, never per hand (2026-11-18). A credit adds no fee
 * progress, and the settle only ever releases, so the credit decides on the
 * stored gate and the hourly sweep and the live cash-out release it.
 * Native proof: scripts/ci/test-promo-winnings-credit-never-settles-progress.py.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(__dirname, '..', 'supabase/migrations');

/** The body (comments removed) of the last migration that defines the function. */
function latestBody(fn: string): string {
  let found: string | null = null;
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(migrations, file), 'utf8');
    const at = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    if (at < 0) continue;
    const open = /\$([a-z_]*)\$/i.exec(sql.slice(at));
    if (!open) continue;
    const start = at + open.index + open[0].length;
    const end = sql.indexOf(open[0], start);
    found = sql.slice(start, end).replace(/--[^\n]*/g, '');
  }
  if (found === null) throw new Error(`${fn} is not defined by any migration`);
  return found;
}

describe('a promo winnings credit never settles promo progress inside a payout', () => {
  const credit = latestBody('fn_ca_promo_profit_credit_owned');
  const entry = latestBody('fn_ca_promo_profit_finish_entry_fee');

  it('the credit never runs a settle or reads the fee history', () => {
    expect(credit).not.toContain('fn_ca_promo_profit_settle(');
    expect(credit).not.toContain('fn_ca_promo_shared_fee_state');
    expect(credit).not.toContain('fn_ca_promo_fee_state_');
  });

  it('the credit still decides restriction on the stored gate and the override', () => {
    expect(credit).toMatch(
      /p_amount>0 AND EXISTS\(SELECT 1 FROM public\.ca_promo_profit_gates w WHERE w\.grant_id=p_grant AND w\.unlocked_at IS NULL\)/
    );
    expect(credit).toMatch(
      /NOT EXISTS\(SELECT 1 FROM public\.ca_promo_profit_overrides o WHERE o\.grant_id=p_grant\)/
    );
    expect(credit).toContain('restricted:=p_amount;');
    expect(credit).toContain('INSERT INTO public.ca_promo_profit_custody');
    expect(credit).toContain('INSERT INTO public.ca_promo_profit_realization_receipts');
  });

  it('an entry fee is consumed and never settles, a satellite seat or a paid entry', () => {
    expect(entry).toContain('fn_ca_promo_profit_consume_entry_fee(p_charge)');
    expect(entry).not.toContain('fn_ca_promo_profit_settle(');
  });
});
