/**
 * Dan 2026-11-02: "INSIDE THE UNION WALLETS, UNION BANK, RAKE TREASURY, BACK UP
 * BBJ WALLET, PROMO WALLET AND SPINS TREASURY, SHOULD BE A TRANSACTION LOG OF
 * ANY OUTS, AND A ONE TIME DAILY "INS" WHERE IT GIVES THE DAILY TOTALS
 * COLLECTED."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const READER = readFileSync(
  'supabase/migrations/20261102083808_union_treasury_log_shows_only_closed_history.sql',
  'utf8'
);
const MIG = readFileSync(
  'supabase/migrations/20261102063939_union_treasury_transaction_logs.sql',
  'utf8'
);
const LOG = readFileSync('src/components/union/UnionTreasuryLog.tsx', 'utf8');
const MODAL = readFileSync('src/components/union/UnionWalletModal.tsx', 'utf8');
const DETAIL = readFileSync('src/components/union/UnionTreasuryDetailModal.tsx', 'utf8');

describe('union treasury transaction log', () => {
  it('logs every out individually and collection as one daily row per wallet', () => {
    expect(MIG).toMatch(
      /entry_kind\s+text\s+NOT NULL CHECK \(entry_kind IN \('out','in','daily_in'\)\)/
    );
    expect(MIG).toMatch(
      /ux_ca_union_treasury_log_daily[\s\S]*?\(union_id, wallet_key, log_day\)[\s\S]*?WHERE entry_kind = 'daily_in'/
    );
    expect(MIG).toContain(
      "WHERE g.side = 'out' OR NOT fn_union_treasury_is_collection(g.category)"
    );
  });

  it('covers all six union treasuries', () => {
    for (const w of ['union_bank', 'rake_treasury', 'backup_bbj', 'promo', 'spins_treasury']) {
      expect(MIG).toContain(`'${w}'`);
    }
    for (const k of [
      "chips: 'union_bank'",
      "promo: 'promo'",
      "spin_reserve: 'spins_treasury'",
      "bbj: 'backup_bbj'",
      "rake: 'rake_treasury'",
    ]) {
      expect(MODAL).toContain(k);
    }
    expect(DETAIL).toContain('wallet="rake_treasury"');
    expect(DETAIL).toContain("'backup_bbj'");
  });

  it('is union staff only and read through one RPC', () => {
    expect(MIG).toContain('fn_union_can_manage_wallets(p_union_id, v_actor)');
    expect(MIG).toContain(
      'REVOKE ALL ON public.ca_union_treasury_log FROM public, anon, authenticated, service_role'
    );
    expect(LOG).toContain("supabase.rpc('fn_union_treasury_log'");
  });

  it('names the timezone the day closes in', () => {
    expect(MIG).toContain("AT TIME ZONE 'America/Chicago'");
  });

  it('never lists or totals a day before every hour of it has closed (verified 2026-11-02)', () => {
    // A daily row waits for the day's last hour; nothing older than the newest
    // gap-free run of closed hours is listed or summed while history fills.
    expect(READER).toContain('<= v_closed_until)');
    expect(READER).toContain('AND t.occurred_at >= v_from_ts');
    expect(READER).toContain("'filling',        v_cover_start > v_floor");
    expect(LOG).toContain('Earlier History Is Still Filling In.');
  });

  it('exports the whole filtered log, not just the rows on screen', () => {
    expect(READER).toContain('least(greatest(coalesce(p_limit, 50), 1), 5000)');
    expect(LOG).toMatch(/for \(;;\) \{[\s\S]*?p_limit: EXPORT_PAGE[\s\S]*?if \(!res\.has_more/);
  });

  it('names the Spins row balance for what it is: the spin pool, not the treasury', () => {
    expect(LOG).toContain(
      "wallet === 'spins_treasury' ? 'Spin Pool Balance After' : 'Balance After'"
    );
  });
});
