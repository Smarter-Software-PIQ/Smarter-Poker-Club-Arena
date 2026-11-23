/**
 * THE DAILY DIGEST'S BIG DIAMOND MOVES SKIP CERTIFICATION FIXTURES
 * (2026-11-23, Production Alerts fleet, incident 331657-digest-fixture-diamond-moves).
 *
 * operational_alert_events 331657 (day 2026-11-02), 339500 (2026-11-03) and
 * 348143 (2026-11-04) are DailyDigest.big_diamond_move. Each named an 18,975
 * Diamond `adjustment` to a `Certbuy*` account: the Table Studio commerce
 * certification funds a throwaway `@example.invalid` buyer, tests a purchase
 * and deletes the account. Those were test fixtures, not money moving between
 * people, but fn_sp_daily_metrics_compute listed every |amount| > 10,000 row
 * of diamond_transactions in `big_movements`, so the owner's digest reported
 * them every night.
 *
 * 20261105174204 adds, in place, to the big_movements WHERE clause:
 *   AND NOT EXISTS (SELECT 1 FROM auth.users au
 *                   WHERE au.id = dt.user_id AND au.email ~* '\.invalid$')
 * Live since 2026-11-05 (fn_sp_daily_metrics_compute md5 defe7f21 carries it);
 * no certification fixture has appeared in big_movements since 2026-11-04.
 *
 * The guard skips only reserved `.invalid` identities. It must never become a
 * horse or owner filter: the same rows showed KINGFISH's Diamond Spins
 * settlements and BarryWhite's Stripe purchases, which are real movements, and
 * CLAUDE.md 10.5 forbids silently dropping horses from a report.
 *
 * This law keeps the fix in place.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();

const FIX = '20261105174204_digest_big_diamond_moves_skip_certification_fixtures.sql';
const GUARD =
  "AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = dt.user_id AND au.email ~* ''\\.invalid$'')";
const FULL_REDEFINITION = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i;

const read = (f: string) => (files.includes(f) ? readFileSync(join(DIR, f), 'utf8') : '');

describe("the digest's big diamond moves skip certification fixtures", () => {
  it('the fixing migration is present', () => {
    expect(files).toContain(FIX);
  });

  it('it adds the .invalid identity guard to the big_movements filter, and refuses a missing anchor', () => {
    const sql = read(FIX);
    expect(sql).toContain(GUARD);
    expect(sql).toContain("WHERE abs(dt.amount) > v_big AND dt.tt NOT IN (''arena_deposit'',''arena_withdraw'')");
    expect(sql).toContain("raise exception 'big_movements anchor not found'");
  });

  it('the guard skips reserved .invalid identities only, never horses or a named player', () => {
    const sql = read(FIX);
    expect(sql).not.toMatch(/is_horse/i);
    expect(sql).not.toMatch(/sp_real_humans/i);
    expect(sql).not.toMatch(/username\s*(=|<>|!=|~|ILIKE|LIKE)/i);
  });

  it('the fix changes no money', () => {
    const sql = read(FIX);
    expect(sql).not.toMatch(
      /\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.(diamond_transactions|diamond_wallets|user_diamond_balance|chip_ledger|club_members)\b/i
    );
  });

  it('no later migration redefines the metrics compute without the guard', () => {
    for (const f of files.slice(files.indexOf(FIX) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (FULL_REDEFINITION.test(sql)) {
        expect(sql, `${f} redefines fn_sp_daily_metrics_compute`).toMatch(
          /au\.email ~\* '\\\.invalid\$'/
        );
      }
    }
  });
});
