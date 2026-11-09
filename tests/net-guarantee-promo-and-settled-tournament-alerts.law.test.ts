/**
 * ===========================================================================
 *  NET GUARANTEE PROMO CONSERVATION AND SETTLED TOURNAMENT ALERTS (2026-11-09)
 * ===========================================================================
 *
 * Migration 20261108041131 added fn_ca_fund_union_guarantee_promo_locked(uuid),
 * which funds net guarantee shortfalls at registration close via a chip_ledger
 * leg with category = 'promo_send', from_type = 'union_wallet',
 * to_type = 'prize_liability', metadata->>'kind' = 'net_guarantee_promo'.
 *
 * Migration 20261109151859 teaches all three tournament accounting readers
 * (`fn_ca_tournament_escrow_chips`, `fn_tournament_conservation_delta`, and
 * `fn_tournament_conservation_deltas`) to include `net_guarantee_promo` legs,
 * teaches `fn_resolve_settled_financial_alerts` to resolve receipt-proven
 * `Tournament.satellite_qualifiers_refused_repeatedly` and
 * `tournament.real_time_payout_refused` alerts (including satellites settled
 * via `tournament_satellite_settlements` with zero cash remainder), and teaches
 * `auditFreeBuyBoard` to skip `CANCELLED` rows so replaced events do not raise
 * false board-drift alerts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = join(__dirname, '..');
const MIG_DIR = join(ROOT_DIR, 'supabase', 'migrations');
const TARGET_MIG =
  '20261109151859_net_guarantee_promo_conservation_and_settled_tournament_aler.sql';

const files = readdirSync(MIG_DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();

function newestMentioning(needle: RegExp): { file: string; sql: string } {
  const from = files.indexOf(TARGET_MIG);
  let found = { file: TARGET_MIG, sql: readFileSync(join(MIG_DIR, TARGET_MIG), 'utf8') };
  for (const f of files.slice(Math.max(0, from))) {
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    if (needle.test(sql)) found = { file: f, sql };
  }
  return found;
}

describe('net guarantee promo conservation and settled tournament alert closure', () => {
  it('the escrow shadow and both conservation readers count net_guarantee_promo legs', () => {
    const escrow = newestMentioning(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_tournament_escrow_chips\(|pg_get_functiondef\('public\.fn_ca_tournament_escrow_chips/
    );
    expect(escrow.sql, `${escrow.file} must keep net_guarantee_promo in escrow shadow`).toContain(
      'net_guarantee_promo'
    );
    expect(escrow.sql, `${escrow.file} must keep free_buy_entry_promo in escrow shadow`).toContain(
      'free_buy_entry_promo'
    );

    const delta = newestMentioning(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_tournament_conservation_delta\(|pg_get_functiondef\('public\.fn_tournament_conservation_delta\(/
    );
    expect(
      delta.sql,
      `${delta.file} must keep net_guarantee_promo in scalar conservation delta`
    ).toContain('net_guarantee_promo');

    const deltas = newestMentioning(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_tournament_conservation_deltas\(|pg_get_functiondef\('public\.fn_tournament_conservation_deltas\(/
    );
    expect(
      deltas.sql,
      `${deltas.file} must keep net_guarantee_promo in set conservation deltas`
    ).toContain('net_guarantee_promo');
  });

  it('fn_resolve_settled_financial_alerts closes receipt-proven satellite qualifier and payout refusals', () => {
    const resolver = newestMentioning(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_resolve_settled_financial_alerts\(|pg_get_functiondef\('public\.fn_resolve_settled_financial_alerts\(/
    );
    expect(resolver.sql).toContain('Tournament.satellite_qualifiers_refused_repeatedly');
    expect(resolver.sql).toContain('tournament.real_time_payout_refused');
    expect(resolver.sql).toContain('tournament_satellite_settlements');
    expect(resolver.sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_resolve_settled_financial_alerts\(boolean,\s*integer\)\s+FROM PUBLIC,\s*anon,\s*authenticated/
    );
  });

  it('auditFreeBuyBoard skips CANCELLED rows so a replaced Free Buy does not cry duplicate', () => {
    const freeBuySrc = readFileSync(
      join(ROOT_DIR, 'server', 'src', 'services', 'FreeBuy.ts'),
      'utf8'
    );
    expect(freeBuySrc).toMatch(/st !== 'CANCELLED' && st !== 'CANCELED'/);
  });
});
