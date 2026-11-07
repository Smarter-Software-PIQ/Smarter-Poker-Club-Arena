/**
 * THE WELCOME-BACK PROMO HAS ONE GUARD, AND NOTHING SCHEDULED REPAIRS IT.
 *
 * Owner report, 2026-11-07: "YOU SENT THE 25 CHIPS TO ALL THE PLAYERS TWICE."
 * 32 members held 50 instead of 25.
 *
 * fn_sp_signup_welcome_back_run (20261104145956) was never wrong. It skips any
 * player holding an 'awarded' row in sp_signup_welcome_back_awards and derives
 * its op_id from the player id so fn_promo_disburse answers a replay. It was
 * BYPASSED: 127 of the 160 grants came from management-API backfills calling
 * fn_promo_disburse directly with fresh op_ids, so 95 of the 128 paid members
 * had no awards row and the runner could not see that they had been paid.
 *
 * Two mistakes are pinned here so neither comes back:
 *
 *   1. A SECOND GUARD. 20261107124625 added ca_union_promo_campaign_claims and
 *      fn_ca_union_promo_grant_once - a parallel claim table for a campaign
 *      that already had a guard. Two guards that must agree about one campaign
 *      is CLAUDE.md 10.84 (three lists had to agree and nothing checked them):
 *      the next agent cannot tell which is authoritative. 20261107130207 drops
 *      it, and sp_signup_welcome_back_awards is the only guard.
 *
 *   2. A SCHEDULED REPAIR. The first attempt at this fix was an hourly audit
 *      that found duplicate promo legs and clawed them back automatically.
 *      That is exactly what CLAUDE.md 10.12 forbids - "IT IS NO LONGER ALLOWED
 *      TO CREATE ANYTHING THAT MONITORS AND BACK FILLS OR ADJUSTS A PAYOUT" -
 *      and it was never applied. The fix is that the guard is complete, not
 *      that something sweeps up afterwards.
 *
 * fn_ca_union_promo_reverse_duplicate (20261107071720) is NOT a repair job and
 * is deliberately still here: it is the one-time settlement door the owner's
 * claw-back went through, called by hand, on a named leg, never on a schedule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
function read(fragment: string): string {
  const f = FILES.filter((x) => x.includes(fragment));
  if (f.length === 0) throw new Error(`no migration matching ${fragment}`);
  return readFileSync(resolve(DIR, f[f.length - 1]), 'utf8');
}
const ALL = FILES.map((f) => ({ name: f, sql: readFileSync(resolve(DIR, f), 'utf8') }));

describe('the welcome-back promo has one guard', () => {
  it('the runner skips a player who already has an awarded row', () => {
    const sql = read('new_signups_in_the_digest_and_welcome_back_chips');
    expect(sql).toContain('sp_signup_welcome_back_awards');
    // the guard: an awarded row means this player is not paid again
    expect(sql).toMatch(/NOT EXISTS[\s\S]{0,200}sp_signup_welcome_back_awards[\s\S]{0,120}'awarded'/);
  });

  it('the runner derives one op id per player for life', () => {
    const sql = read('new_signups_in_the_digest_and_welcome_back_chips');
    expect(sql).toContain("md5('signup-welcome-back:");
  });

  it('the awards table is the only guard: no parallel claim mechanism survives', () => {
    // The recording (…124625) created it and the repair (…130207) drops it.
    // Nothing later may bring either back.
    const dropped = read('welcome_back_awards_sees_every_paid_player');
    expect(dropped).toContain('DROP TABLE IF EXISTS public.ca_union_promo_campaign_claims');
    expect(dropped).toContain('DROP FUNCTION IF EXISTS public.fn_ca_union_promo_grant_once');

    const creators = ALL.filter(
      (m) =>
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_union_promo_grant_once/i.test(m.sql) ||
        /CREATE\s+TABLE[\s\S]{0,40}public\.ca_union_promo_campaign_claims/i.test(m.sql),
    ).map((m) => m.name);
    // only the historical recording may contain the creation
    expect(creators).toEqual(['20261107124625_ca_union_promo_grant_once.sql']);
  });

  it('nothing monitors, audits or claws back this promo on a schedule (10.12)', () => {
    for (const { name, sql } of ALL) {
      expect(
        /fn_ca_duplicate_promo_audit/i.test(sql),
        `${name} adds a scheduled duplicate-promo audit; CLAUDE.md 10.12 forbids a monitor or back-fill as the fix`,
      ).toBe(false);
      const schedulesPromoRepair =
        /cron\.schedule\s*\([^)]*promo[^)]*(audit|repair|sweep|backfill|back_pay|heal|redrive)/i.test(sql);
      expect(
        schedulesPromoRepair,
        `${name} schedules a promo repair job; CLAUDE.md 10.12 forbids it`,
      ).toBe(false);
    }
  });

  it('the one-time settlement door is gated, skips spent chips and never goes negative', () => {
    const sql = read('fn_ca_union_promo_reverse_duplicate');
    // it is not scheduled anywhere
    for (const { sql: other } of ALL) {
      expect(/cron\.schedule\s*\([^)]*fn_ca_union_promo_reverse_duplicate/i.test(other)).toBe(false);
    }
    // spent is spent: it skips rather than driving a wallet negative
    expect(sql).toMatch(/v_held\s*<\s*v_leg\.amount/);
    expect(sql).toContain("'already_spent'");
    // one reversal per leg
    expect(sql).toContain('reverses_ledger_id');
    // only this promo's own leg, and only the union owner or a service caller
    expect(sql).toContain("description = 'Union Promo Disbursement'");
    expect(sql).toContain('Only The Union Owner May Reverse Union Promo');
  });

  it('the repair moves no chips: it writes no balance and no ledger leg', () => {
    const sql = read('welcome_back_awards_sees_every_paid_player');
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?club_members/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?union_wallets/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+(public\.)?chip_ledger/i);
  });
});
