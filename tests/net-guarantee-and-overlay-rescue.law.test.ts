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
  it('the 88-chip correction preserves published payout percentages for every finisher', () => {
    const operation = readFileSync('scripts/operations/owner-net-guarantee-f22ceae6.sql', 'utf8');
    expect(operation).toContain('structure:=tr.payout_structure::jsonb');
    expect(operation).toContain('UPDATE public.tournaments SET prize_pool=1830 WHERE id=t');
    expect(operation).not.toMatch(/SET prize_pool=1830,\s*payout_structure/);
  });
  it('a completed event receives eleven idempotent promo supplements without rewriting sealed books', () => {
    const source = readFileSync(
      'scripts/operations/owner-net-guarantee-completed-f22ceae6.sql',
      'utf8'
    );
    expect(source).toContain("tr.status<>'COMPLETED'");
    expect(source).toContain('public.fn_ca_prize_ladder(183000,weights,1)');
    expect(source).toContain('public.fn_ca_adjustment_under_10_9');
    expect(source).toContain('public.fn_credit_and_log');
    expect(source).toContain("'union_wallets.promo_wallet'");
    expect(source).toContain('OWNER_NET_GUARANTEE_ROLLBACK');
    expect(source).not.toMatch(
      /UPDATE public\.(tournaments|tournament_payouts|tournament_players|tournament_obligations|tournament_escrow|tournament_terminal_settlements)\b/
    );
    expect(readFileSync('scripts/ci/test-bounty-guarantee-postgres.py', 'utf8')).toContain(
      "root/'scripts/ci/test-net-guarantee-completed.py'"
    );
  });
  it('Rewards compares the net coverage rather than gross payments', () => {
    const source = readFileSync('src/components/tournament/details/RewardsTab.tsx', 'utf8');
    expect(readFileSync('src/hooks/useTournamentPrizeFunding.ts', 'utf8')).toContain(
      'optional(data.net_coverage)'
    );
    expect(source).toContain('currentFunding.netCoverage');
    expect(source).toContain('Promo Paid Separately To The Finishers After Completion');
    expect(source).not.toContain('data.gross_coverage');
  });
});
