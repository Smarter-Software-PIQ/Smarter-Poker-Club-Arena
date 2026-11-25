import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClubDataReconciliation from '../../src/components/club/ClubDataReconciliation';
import {
  financialWindowStatus,
  parseClubDataReconciliation,
} from '../../src/lib/clubDataReconciliation';

const range = { start: '2026-11-09', end: '2026-11-15' };
const totals = {
  complete: true,
  missing_days: [],
  bbj_gross: 166462.81,
  bbj_awards: 25611.6,
  bbj_net: 140851.21,
  cash_fee: 817368.93,
  cash_winnings: -958220.14,
  tournament_fee: 98047.08,
  tournament_winnings: -102954.39,
  cash_residual: 0,
  tournament_flow_difference: 4907.31,
};
afterEach(cleanup);

describe('financial totals keep source qualification separate from billing finality', () => {
  it('shows gross BBJ, awards and net separately with the exact uncertified closing instant', () => {
    render(
      <ClubDataReconciliation
        basis="union_invoice_accounting"
        range={range}
        coverage={{ complete: true, provisional: true, awaiting_boundary_days: ['2026-11-15'] }}
        reconciliation={totals}
      />
    );
    expect(screen.getByText('166,462.81')).toBeInTheDocument();
    expect(screen.getByText('25,611.60')).toBeInTheDocument();
    expect(screen.getByText('140,851.21')).toBeInTheDocument();
    expect(screen.getByText('Posted Totals Verified')).toBeInTheDocument();
    expect(screen.getByText('Final Billing Pending')).toBeInTheDocument();
    expect(screen.getByText(/Nov 16, 2026 12:00 AM Pacific Time/)).toBeInTheDocument();
    expect(screen.queryByText('Billing Finalized')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Reconciliation Drilldowns' })).toBeNull();
    expect(screen.getByText(/A Game Played On Multiple Days Counts Once/)).toBeInTheDocument();
  });
  it('opens real drilldowns and identifies snapshot evidence without inventing revisions', () => {
    const games = vi.fn(),
      players = vi.fn(),
      history = vi.fn();
    render(
      <ClubDataReconciliation
        basis="union_invoice_accounting"
        range={range}
        reconciliation={totals}
        generatedAt="2026-11-16T08:00:00Z"
        onGames={games}
        onPlayers={players}
        onHistory={history}
      />
    );
    const drilldowns = within(screen.getByRole('group', { name: 'Reconciliation Drilldowns' }));
    fireEvent.click(drilldowns.getByRole('button', { name: 'View Contributing Games' }));
    fireEvent.click(drilldowns.getByRole('button', { name: 'View Player Totals' }));
    fireEvent.click(screen.getByText('View Issued Invoices'));
    expect(games).toHaveBeenCalledOnce();
    expect(players).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
    expect(screen.getByText(/Does Not Contain A Revision-By-Revision History/)).toBeInTheDocument();
    expect(screen.getByText(/Source Snapshot:/)).toHaveTextContent('Chicago Time');
  });
  it('does not turn an absent or unqualified BBJ answer into zero', () => {
    const view = render(<ClubDataReconciliation basis="union_invoice_accounting" range={range} />);
    expect(screen.getAllByText('Unavailable')).toHaveLength(9);
    view.rerender(
      <ClubDataReconciliation
        basis="union_invoice_accounting"
        range={range}
        reconciliation={{
          ...totals,
          complete: false,
          missing_days: ['2026-11-10'],
          bbj_gross: null,
          bbj_awards: null,
          bbj_net: null,
          cash_residual: null,
        }}
      />
    );
    expect(within(screen.getByLabelText('BBJ Totals')).queryByText('0.00')).toBeNull();
    expect(screen.queryByText('166,462.81')).not.toBeInTheDocument();
    expect(screen.getByText(/Missing Dates: 2026-11-10/)).toBeInTheDocument();
  });
  it('retains a real nonzero filtered cash difference without calling it BBJ', () => {
    render(
      <ClubDataReconciliation
        basis="union_invoice_accounting"
        range={range}
        reconciliation={{ ...totals, cash_residual: -125.5 }}
      />
    );
    expect(screen.getByText('-125.50')).toBeInTheDocument();
    expect(screen.getByText('4,907.31')).toBeInTheDocument();
    expect(screen.getByText(/Neither Difference Is BBJ Collected/)).toBeInTheDocument();
  });
  it('requires explicit invoice coverage and a past certified window before finality', () => {
    const status = (coverage: any, basis = 'union_invoice_accounting') =>
      financialWindowStatus(basis, coverage, range, '2026-11-16');
    const certified = {
      complete: true,
      provisional: false,
      missing_days: [],
      failed_days: [],
      not_invoice_exact_days: [],
      awaiting_boundary_days: [],
    };
    expect(status({ complete: true }).final).toBe(false);
    expect(status({ complete: true, provisional: false }).final).toBe(false);
    expect(status(certified).final).toBe(true);
    for (const key of [
      'missing_days',
      'failed_days',
      'not_invoice_exact_days',
      'awaiting_boundary_days',
    ]) {
      expect(status({ ...certified, [key]: ['2026-11-15'] }).final).toBe(false);
    }
    expect(status({ complete: true, provisional: false }, 'pacific_net_money_flow').final).toBe(
      false
    );
    expect(
      financialWindowStatus(
        'union_invoice_accounting',
        { complete: true, provisional: false },
        { start: '2026-11-16', end: '2026-11-16' },
        '2026-11-16'
      ).final
    ).toBe(false);
    expect(
      financialWindowStatus(
        'union_invoice_accounting',
        certified,
        { start: '2026-11-09', end: '2026-11-16' },
        '2026-11-16'
      ).current
    ).toBe(false);
    expect(
      financialWindowStatus(
        'union_invoice_accounting',
        certified,
        { start: '2026-11-16', end: '2026-11-16' },
        '2026-11-16'
      ).current
    ).toBe(true);
  });
  it('rejects malformed qualified amounts and hides invoice claims for a legacy basis', () => {
    expect(parseClubDataReconciliation({ ...totals, bbj_gross: null })).toBeNull();
    expect(parseClubDataReconciliation({ ...totals, bbj_net: Number.NaN })).toBeNull();
    expect(parseClubDataReconciliation({ ...totals, missing_days: ['2026-02-30'] })).toBeNull();
    const { container } = render(
      <ClubDataReconciliation
        basis="pacific_net_money_flow"
        range={range}
        reconciliation={totals}
        coverage={{ complete: true, provisional: false }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
