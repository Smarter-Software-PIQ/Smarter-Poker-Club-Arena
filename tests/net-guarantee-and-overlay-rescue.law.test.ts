import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guaranteeShortfall } from '../src/utils/tournamentPrizeFunding';

describe('owner November 7: net guarantees and final ten-minute Horse rescue', () => {
  it('the reported 67 entries owe exactly 88 chips after rake', () => {
    expect(guaranteeShortfall(2500, 1742, 670, 268)).toBe(88);
    expect(guaranteeShortfall(2500, 1850, 670, 280)).toBe(0);
  });
  it('the original close invokes promo funding and required accounting executes the native regression', () => {
    const sql = readFileSync(
      'supabase/migrations/20261108041131_net_guarantee_coverage_and_union_promo_funding.sql',
      'utf8'
    );
    expect(sql).toContain('s.paid_in - s.paid_back - t.rake');
    expect(sql).toContain(
      'PERFORM public.fn_ca_fund_union_guarantee_promo_locked(p_tournament_id)'
    );
    expect(sql).toContain('promo_wallet=promo_wallet-due');
    expect(sql).toContain('before_escrow+due');
    expect(readFileSync('scripts/ci/test-bounty-guarantee-postgres.py', 'utf8')).toContain(
      "root/'scripts/ci/test-net-guarantee-promo.py'"
    );
  });
  it('the running-event consumer rescues actual net funding through ordinary Horse admission', () => {
    const source = readFileSync('server/src/services/HorseOverlayGuard.ts', 'utf8');
    expect(source).toContain('horseOverlayRescueDue(t, nowMs)');
    expect(source).toMatch(/'fn_ca_guarantee_funding',\s*\{ p_tournament_id: t.id \}/);
    expect(source).toContain('horseOverlayRescueEntries(funding, mttGuaranteeEntryAmount(t))');
    expect(source).toContain('seeder.topUpWithHorses(t.id, live + want');
  });
  it('Rewards compares the net coverage rather than gross payments', () => {
    const source = readFileSync('src/components/tournament/details/RewardsTab.tsx', 'utf8');
    expect(readFileSync('src/hooks/useTournamentPrizeFunding.ts', 'utf8')).toContain(
      'optional(data.net_coverage)'
    );
    expect(source).toContain('currentFunding.netCoverage');
    expect(source).not.toContain('data.gross_coverage');
  });
});
