/**
 * The chip statement shows both directions, the audit line, and refuses to
 * guess (phase 7, roadmap 9.5).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const auth = vi.hoisted(() => ({
  user: { id: 'u' } as { id: string } | null,
  generation: 0,
  guards: new Map<string, () => boolean>(),
}));
const tournamentNames = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => ({
      select: () => ({ in: (_column: string, ids: string[]) => tournamentNames(table, ids) }),
    }),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: auth.user, isHydrating: false }),
}));
vi.mock('../../src/hooks/useCashoutScope', () => ({
  useCashoutScope: (accountId: string | undefined) => {
    const generation = auth.generation;
    const key = `${accountId ?? 'none'}:${generation}`;
    const guard =
      auth.guards.get(key) ?? (() => auth.generation === generation && auth.user?.id === accountId);
    auth.guards.set(key, guard);
    return guard;
  },
  useCashoutScopeKey: (accountId: string | undefined, view: string) =>
    JSON.stringify([accountId, view, auth.generation]),
}));
vi.mock('../../src/components/tournament/TournamentPaymentStatus', () => ({ default: () => null }));

import ChipStatement, {
  PROMO_TICKET_RETURN_DESCRIPTION,
  categoryLabel,
  counterpartyLabel,
  isPromoReturnLeg,
  statementLegCopy,
  type StatementLeg,
} from '../../src/components/wallet/ChipStatement';

const leg = (over: Record<string, unknown>) => ({
  id: 'l1',
  at: '2026-09-07T22:00:00.000000+00:00',
  direction: 'in',
  amount: 12.5,
  category: 'tournament_prize',
  description: null,
  counterparty_type: 'prize_liability',
  counterparty_label: null,
  counterparty_id: 'x',
  club_id: 'c',
  table_id: null,
  tournament_id: 't',
  hand_id: null,
  settlement_id: null,
  ...over,
});

const statement = (over: Record<string, unknown> = {}) => {
  const base = {
    scope: 'player',
    entity_id: 'u',
    account: 'player_wallet:u:club_members.chip_balance',
    club_filter: null,
    balance_now: 256869.48,
    balance_exists: true,
    clubs: [
      { club_id: 'a', club_name: 'Alpha', balance: 100 },
      { club_id: 'b', club_name: 'Beta', balance: 256769.48 },
    ],
    legs: [
      leg({ id: 'l1' }),
      leg({
        id: 'l2',
        at: '2026-09-07T21:00:00.123456+00:00',
        direction: 'out',
        category: 'tournament_buyin',
        amount: 50,
      }),
    ],
    has_more: true,
    next_before: '2026-09-07T21:00:00.123456+00:00',
    next_cursor: {
      at: '2026-09-07T21:00:00.123456+00:00',
      id: 'l2',
      direction: 'out',
      account: 'player_wallet:u:club_members.chip_balance',
      club_filter: null,
    },
    audit: {
      status: 'reconciles',
      read_at: '2026-09-07T06:40:00Z',
      balance_at_reading: 255662.53,
      in_since: 2329.95,
      out_since: 1123,
      legs_since: 89,
      expected_now: 256869.48,
      balance_now: 256869.48,
      unexplained: 0,
    },
    generated_at: '2026-09-07T22:26:47Z',
    ms: 525,
  };
  const merged = { ...base, ...over };
  if ('balance_now' in over && !('audit' in over)) {
    merged.audit = { ...base.audit, balance_now: over.balance_now };
  }
  return merged;
};

beforeEach(() => {
  rpc.mockReset();
  tournamentNames.mockReset();
  tournamentNames.mockResolvedValue({ data: [], error: null });
  auth.user = { id: 'u' };
  auth.generation = 0;
  auth.guards.clear();
});

describe('ChipStatement', () => {
  it("asks for the caller's own statement and renders both directions with the audit line", async () => {
    let resolveStatement!: (value: unknown) => void;
    rpc.mockReturnValueOnce(new Promise((resolve) => (resolveStatement = resolve)));
    const view = render(<ChipStatement scope="player" />);
    // The heading exists during loading; it cannot certify the response rendered.
    expect(screen.getByText('Your Chip Statement')).toBeTruthy();
    expect(view.container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('+12.50')).toBeNull();
    await act(async () => {
      resolveStatement({ data: statement(), error: null });
    });
    expect(await screen.findByText('+12.50')).toBeTruthy();
    expect(view.container.querySelector('section')).not.toHaveAttribute('aria-busy');
    expect(rpc).toHaveBeenCalledWith('fn_ca_chip_statement_page', {
      p_scope: 'player',
      p_club_id: null,
      p_cursor: null,
      p_limit: 50,
    });
    expect(screen.getByText('+12.50')).toBeTruthy(); // in
    expect(screen.getByText('-50')).toBeTruthy(); // out - the direction the old feed never showed
    expect(screen.getByText('Tournament Entry')).toBeTruthy();
    expect(screen.getByText(/Reconciles\./)).toBeTruthy();
    expect(screen.getByText(/255,662\.53/)).toBeTruthy(); // balance at reading, exact
    expect(screen.getByText('Beta')).toBeTruthy(); // balance by club
  });

  it('passes the full server cursor unchanged, including microseconds, and appends', async () => {
    rpc.mockResolvedValueOnce({ data: statement(), error: null });
    rpc.mockResolvedValueOnce({
      data: statement({
        legs: [leg({ id: 'l3', at: '2026-09-07T20:00:00.123456+00:00', amount: 7 })],
        has_more: false,
        next_cursor: null,
      }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    await waitFor(() => screen.getByText('Load Earlier Movements'));
    fireEvent.click(screen.getByText('Load Earlier Movements'));
    await waitFor(() => expect(screen.getByText('+7')).toBeTruthy());
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_ca_chip_statement_page',
      expect.objectContaining({ p_cursor: statement().next_cursor })
    );
    expect(screen.queryByText('Load Earlier Movements')).toBeNull();
  });

  it('says out loud when the balance does not reconcile', async () => {
    rpc.mockResolvedValueOnce({
      data: statement({
        balance_now: 256870,
        audit: {
          ...statement().audit,
          status: 'does_not_reconcile',
          balance_now: 256870,
          unexplained: 0.52,
        },
      }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    await waitFor(() => expect(screen.getByText(/Does Not Reconcile\./)).toBeTruthy());
    expect(screen.getByText(/Difference 0\.52/)).toBeTruthy();
  });

  it('keeps both directions when a self-transfer spans pages', async () => {
    rpc.mockResolvedValueOnce({
      data: statement({
        legs: [leg({ id: 'same-transfer', amount: 7 })],
        next_before: '2026-09-07T22:00:00.000000+00:00',
        next_cursor: {
          at: '2026-09-07T22:00:00.000000+00:00',
          id: 'same-transfer',
          direction: 'in',
          account: 'player_wallet:u:club_members.chip_balance',
          club_filter: null,
        },
      }),
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: statement({
        legs: [leg({ id: 'same-transfer', direction: 'out', amount: 7 })],
        has_more: false,
        next_cursor: null,
      }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    fireEvent.click(await screen.findByText('Load Earlier Movements'));
    await screen.findByText('-7');
    expect(screen.getByText('+7')).toBeTruthy();
  });

  it('refuses a response that says more rows exist but loses their cursor', async () => {
    rpc.mockResolvedValueOnce({
      data: statement({ next_cursor: null }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Load Earlier Movements')).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to timestamp pagination when the new reader is unavailable', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'reader unavailable' },
    });
    render(<ChipStatement scope="player" />);
    await screen.findByRole('alert');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('fn_ca_chip_statement_page');
  });

  it('fills both riveted plates in every state, never leaving one empty (launch audit D-08)', async () => {
    const plateLabels = () =>
      Array.from(document.querySelectorAll('.sc__foot .sc-plate')).map((plate) => ({
        label: plate.textContent?.trim(),
        disabled: (plate as HTMLButtonElement).disabled,
      }));

    // Rows, with more to load: Refresh re-reads, the blue plate loads earlier.
    rpc.mockResolvedValue({ data: statement(), error: null });
    const view = render(<ChipStatement scope="player" />);
    await waitFor(() => screen.getByText('Load Earlier Movements'));
    expect(plateLabels()).toEqual([
      { label: 'Refresh', disabled: false },
      { label: 'Load Earlier Movements', disabled: false },
    ]);
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    view.unmount();
    rpc.mockReset();

    // Every movement shown: the blue plate says so and is disabled.
    rpc.mockResolvedValueOnce({
      data: statement({ has_more: false, next_cursor: null }),
      error: null,
    });
    const upToDate = render(<ChipStatement scope="player" />);
    await waitFor(() => screen.getByText('Up To Date'));
    expect(plateLabels()[1]).toEqual({ label: 'Up To Date', disabled: true });
    expect(plateLabels().every((plate) => plate.label)).toBe(true);
    upToDate.unmount();

    // Failed: Try Again is the plate, nothing else is a lit word.
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
    render(<ChipStatement scope="player" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(plateLabels()[0]).toEqual({ label: 'Try Again', disabled: false });
    expect(plateLabels()[1].label).toBeTruthy();
    expect(document.querySelector('.chip-statement__btn')).toBeNull();
  });

  it('never reads an error as "no movements"', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
    render(<ChipStatement scope="player" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('No Chip Movements Yet.')).toBeNull();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('a treasury statement without a club asks nothing and shows nothing false', async () => {
    render(<ChipStatement scope="club_treasury" clubId={null} />);
    await waitFor(() => expect(rpc).not.toHaveBeenCalled());
  });

  it('retires an old statement response when its account scope changes', async () => {
    let resolveOld!: (value: unknown) => void;
    rpc
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce({
        data: statement({
          scope: 'club_treasury',
          entity_id: 'club-b',
          account: 'club_treasury:club-b:clubs.chip_treasury',
          club_filter: 'club-b',
          balance_now: 900,
          clubs: [],
          legs: [leg({ id: 'new', club_id: 'club-b', amount: 90 })],
          has_more: false,
          next_cursor: null,
        }),
        error: null,
      });
    const view = render(<ChipStatement scope="player" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    view.rerender(<ChipStatement scope="club_treasury" clubId="club-b" />);
    expect(await screen.findByText('900')).toBeTruthy();

    await act(async () => {
      resolveOld({ data: statement({ balance_now: 123 }), error: null });
    });
    expect(screen.queryByText('123')).toBeNull();
    expect(screen.getByText('900')).toBeTruthy();
  });

  it('rejects malformed success payloads instead of painting a false empty statement', async () => {
    rpc.mockResolvedValueOnce({
      data: statement({ account: 'player_wallet:someone-else:club_members.chip_balance' }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The Statement Could Not Be Loaded');
    expect(screen.queryByText('No Chip Movements Yet.')).toBeNull();
  });

  it('rejects duplicated rows and a continuation that is not the last row', async () => {
    rpc.mockResolvedValueOnce({
      data: statement({
        legs: [leg({ id: 'duplicate' }), leg({ id: 'duplicate' })],
      }),
      error: null,
    });
    render(<ChipStatement scope="player" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No Chip Movements Yet.')).toBeNull();
  });

  it('retires A to B to A auth generations and never restores either late page', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    rpc
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
      .mockResolvedValueOnce({ data: statement({ balance_now: 300 }), error: null });
    const view = render(<ChipStatement scope="player" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    auth.user = { id: 'b' };
    auth.generation += 1;
    view.rerender(<ChipStatement scope="player" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));

    auth.user = { id: 'u' };
    auth.generation += 1;
    view.rerender(<ChipStatement scope="player" />);
    expect(await screen.findByText('300')).toBeTruthy();
    await act(async () => {
      resolveFirst({ data: statement({ balance_now: 100 }), error: null });
      resolveSecond({ data: statement({ balance_now: 200 }), error: null });
    });
    expect(document.querySelector('.chip-statement__balance-value')?.textContent).toBe('300');
  });

  it('labels carry no em dash and unknown categories are still shown', () => {
    for (const v of Object.values({
      a: categoryLabel('buyin'),
      b: categoryLabel('something_new'),
    })) {
      expect(v).not.toContain('—');
    }
    expect(categoryLabel('something_new')).toBe('Something New');
    expect(
      counterpartyLabel(
        leg({ counterparty_type: 'club_treasury', counterparty_label: 'Deep Stack' })
      )
    ).toBe('The Club (Deep Stack)');
  });

  it('names a storage path by its account and never prints a table or column name', () => {
    // Production chip_ledger labels are storage paths: clubs.chip_treasury
    // rendered as "The Club (Clubs.Chip_Treasury)" on the Treasury Statement.
    expect(
      counterpartyLabel(
        leg({ counterparty_type: 'club_treasury', counterparty_label: 'clubs.chip_treasury' })
      )
    ).toBe('The Club (Club Treasury)');
    expect(
      counterpartyLabel(
        leg({ counterparty_type: 'bbj_pool', counterparty_label: 'bbj_pools.main_balance' })
      )
    ).toBe('The Jackpot (Jackpot Main Pool)');
    const unknown = counterpartyLabel(
      leg({ counterparty_type: 'club_treasury', counterparty_label: 'some_table.some_column' })
    );
    expect(unknown).toBe('The Club');
    expect(
      counterpartyLabel(
        leg({ counterparty_type: 'prize_liability', counterparty_label: 'tournament entry ticket' })
      )
    ).toBe('A Prize Pool (Tournament Entry Ticket)');
    for (const label of [
      'union_wallets.rake_wallet',
      'tournaments.prize_pool+total_rake',
      'spin_bonus_pools.balance',
    ]) {
      expect(
        counterpartyLabel(leg({ counterparty_type: 'union_wallet', counterparty_label: label }))
      ).not.toMatch(/_|\./);
    }
  });

  /* The rows a member read as "all of her spin prizes were reversed"
     (production chip_ledger, 2026-11-22 22:11 UTC, read by id): one refund of
     a 10.00 entry and the promo part of it going back to its fund. */
  describe("a line says what happened in a player's words", () => {
    const EVENT = '0be6a4b5-7a9a-4072-84ec-2353cedaed03';
    const refundLeg = leg({
      id: 'a6b6334c-b566-4ecb-9337-45882e7f0894',
      at: '2026-11-22T22:11:47.006724+00:00',
      direction: 'in',
      amount: 10,
      category: 'refund',
      description: 'auto-audited club_members.chip_balance delta 10.00',
      counterparty_type: 'prize_liability',
      counterparty_label: null,
      counterparty_id: EVENT,
      tournament_id: EVENT,
    }) as StatementLeg;
    const promoReturn = (over: Record<string, unknown> = {}) =>
      leg({
        id: 'b25926f3',
        at: '2026-11-22T22:11:47.934728+00:00',
        direction: 'out',
        amount: 0.77,
        category: 'reversal',
        description: 'Promo Principal Returned To Original Fund',
        counterparty_type: 'union_wallet',
        counterparty_label: 'union_wallets.promo_wallet',
        counterparty_id: 'union',
        tournament_id: null,
        ...over,
      }) as StatementLeg;

    it('a promo return is never a bare Reversal: it names the promo and its sponsor', () => {
      expect(isPromoReturnLeg(promoReturn())).toBe(true);
      expect(statementLegCopy(promoReturn())).toEqual({
        title: 'Promo Chips Returned To Sponsor',
        route: 'To The Union Promo Wallet',
      });
      expect(
        statementLegCopy(
          promoReturn({
            counterparty_type: 'promo_wallet',
            counterparty_label: 'agents.promo_wallet_balance',
          })
        ).route
      ).toBe('To An Agent Promo Wallet');
      expect(
        statementLegCopy(
          promoReturn({
            counterparty_type: 'promo_wallet',
            counterparty_label: 'clubs.promo_balance',
          })
        ).route
      ).toBe('To The Club Promo Wallet');
      // A fund this map has never met still gets its ordinary account wording.
      expect(
        statementLegCopy(
          promoReturn({ counterparty_type: 'promo_wallet', counterparty_label: 'new_fund.balance' })
        )
      ).toEqual({ title: 'Promo Chips Returned To Sponsor', route: 'To A Promo Wallet' });
      // Seen from the receiving side it is still not a reversal of anything.
      expect(
        statementLegCopy(
          promoReturn({
            direction: 'in',
            counterparty_type: 'player_wallet',
            counterparty_label: 'club_members.chip_balance',
          })
        )
      ).toEqual({ title: 'Promo Chips Returned By A Member', route: 'From A Player' });

      // Ticket-refund promo returns (fn_ca_promo_returned_ticket_principal_fee)
      // carry their own description and come from tournament_tickets.value.
      const ticketPromoOut = promoReturn({
        description: PROMO_TICKET_RETURN_DESCRIPTION,
        counterparty_type: 'union_wallet',
        counterparty_label: 'union_wallets.promo_wallet',
      });
      expect(isPromoReturnLeg(ticketPromoOut)).toBe(true);
      expect(statementLegCopy(ticketPromoOut)).toEqual({
        title: 'Promo Chips Returned To Sponsor',
        route: 'To The Union Promo Wallet',
      });
      const ticketPromoIn = promoReturn({
        direction: 'in',
        description: PROMO_TICKET_RETURN_DESCRIPTION,
        counterparty_type: 'escrow',
        counterparty_label: 'tournament_tickets.value',
      });
      expect(isPromoReturnLeg(ticketPromoIn)).toBe(true);
      expect(statementLegCopy(ticketPromoIn)).toEqual({
        title: 'Promo Chips Returned From Ticket',
        route: 'From A Refunded Tournament Ticket',
      });
      expect(statementLegCopy(ticketPromoIn).title.length).toBeLessThanOrEqual(32);

      // Agent promo wallet credits display the account detail cleanly.
      expect(
        statementLegCopy(
          leg({
            category: 'promo',
            counterparty_type: 'agent_wallet',
            counterparty_label: 'agents.promo_wallet_balance',
            tournament_id: null,
          }) as StatementLeg
        )
      ).toEqual({ title: 'Promo Chips', route: 'From An Agent (Agent Promo Wallet)' });

      // Both refund and tournament_refund from a prize pool read identically.
      expect(
        statementLegCopy(
          leg({
            category: 'tournament_refund',
            counterparty_type: 'prize_liability',
          }) as StatementLeg,
          'Nightly 20K'
        )
      ).toEqual({ title: 'Tournament Refund', route: 'From Nightly 20K' });
    });

    it('recognizes every promo-return reversal description written by the database owners', () => {
      const root = resolve(__dirname, '..', '..');
      const walletOwnerSql = readFileSync(
        resolve(
          root,
          'supabase/migrations/20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql'
        ),
        'utf8'
      );
      const ticketOwnerSql = readFileSync(
        resolve(
          root,
          'supabase/migrations/20261123071237_a_refunded_entry_keeps_its_promo_on_a_ticket_and_past_a_clos.sql'
        ),
        'utf8'
      );
      const walletMatch = walletOwnerSql.match(/'reversal',holder_club,'([^']+)'/);
      const ticketMatch = ticketOwnerSql.match(/'reversal',r\.club_id,key,'([^']+)'/);
      expect(walletMatch?.[1]).toBeTruthy();
      expect(ticketMatch?.[1]).toBeTruthy();
      for (const description of [walletMatch![1], ticketMatch![1]]) {
        const row = promoReturn({ description });
        expect(isPromoReturnLeg(row), `unmapped promo return description: ${description}`).toBe(
          true
        );
        expect(statementLegCopy(row).title).not.toBe('Reversal');
      }
    });

    it('any other reversal keeps its own name: the leg does not say it was promo', () => {
      for (const description of [null, '', 'Something Else', 'promo principal returned']) {
        const other = promoReturn({ description });
        expect(isPromoReturnLeg(other)).toBe(false);
        expect(statementLegCopy(other)).toEqual({
          title: 'Reversal',
          route: 'To The Union (Union Promo Wallet)',
        });
      }
    });

    it('a refund from a prize pool is a tournament refund, named by its event when known', () => {
      expect(statementLegCopy(refundLeg)).toEqual({
        title: 'Tournament Refund',
        route: 'From A Prize Pool',
      });
      expect(statementLegCopy(refundLeg, 'satellite into nightly 20K (nlh)')).toEqual({
        title: 'Tournament Refund',
        route: 'From Satellite Into Nightly 20K (NLH)',
      });
      expect(statementLegCopy(refundLeg, '   ').route).toBe('From A Prize Pool');
      // An entry names the same event, so the two lines read as one story.
      expect(
        statementLegCopy(
          leg({ direction: 'out', category: 'tournament_buyin' }) as StatementLeg,
          'Nightly 20K'
        )
      ).toEqual({ title: 'Tournament Entry', route: 'To Nightly 20K' });
      // A refund that did not come from a prize pool is not called a tournament refund,
      // and an event name is never attached to a leg that is not a prize pool's.
      expect(
        statementLegCopy(
          leg({ category: 'refund', counterparty_type: 'club_treasury' }) as StatementLeg,
          'Nightly 20K'
        )
      ).toEqual({ title: 'Refund', route: 'From The Club' });
    });

    it('the promo give-back and unknown or malformed legs fall back safely', () => {
      // The 5.25 returned to the member (chip_ledger 45582f46, category promo).
      expect(
        statementLegCopy(
          leg({
            category: 'promo',
            amount: 5.25,
            description: 'auto-audited club_members.chip_balance delta 5.25',
            counterparty_type: 'union_wallet',
            counterparty_label: 'union_wallets.promo_wallet',
            tournament_id: null,
          }) as StatementLeg
        )
      ).toEqual({ title: 'Promo Chips', route: 'From The Union (Union Promo Wallet)' });
      expect(
        statementLegCopy(
          leg({ category: 'brand_new_kind', counterparty_type: null }) as StatementLeg
        )
      ).toEqual({ title: 'Brand New Kind', route: 'From Unknown' });
      const malformed = {
        direction: 'out',
        category: undefined,
        description: undefined,
        counterparty_type: undefined,
        counterparty_label: undefined,
      } as unknown as StatementLeg;
      expect(isPromoReturnLeg(malformed)).toBe(false);
      expect(statementLegCopy(malformed, undefined)).toEqual({ title: '', route: 'To Unknown' });
      for (const copy of [statementLegCopy(promoReturn()), statementLegCopy(refundLeg, 'A')]) {
        expect(`${copy.title}${copy.route}`).not.toMatch(/\u2014|_/);
        expect(copy.title.length).toBeLessThanOrEqual(32);
      }
    });

    it('renders the refund by its event and the promo return in words, one line per leg', async () => {
      tournamentNames.mockResolvedValue({
        data: [{ id: EVENT, name: 'Satellite Into Nightly 20K (NLH)' }],
        error: null,
      });
      rpc.mockResolvedValue({
        data: statement({
          legs: [promoReturn(), refundLeg],
          has_more: false,
          next_before: null,
          next_cursor: null,
        }),
        error: null,
      });
      render(<ChipStatement scope="player" />);
      expect(await screen.findByText('From Satellite Into Nightly 20K (NLH)')).toBeTruthy();
      expect(tournamentNames).toHaveBeenCalledTimes(1);
      expect(tournamentNames).toHaveBeenCalledWith('tournaments', [EVENT]);
      expect(screen.getByText('Tournament Refund')).toBeTruthy();
      expect(screen.getByText('Promo Chips Returned To Sponsor')).toBeTruthy();
      expect(screen.getByText('To The Union Promo Wallet')).toBeTruthy();
      expect(screen.queryByText('Reversal')).toBeNull();
      expect(document.querySelectorAll('.chip-statement__leg')).toHaveLength(2);
    });

    it('an event name that cannot be read leaves the prize-pool wording and asks once', async () => {
      tournamentNames.mockRejectedValue(new Error('offline'));
      rpc.mockResolvedValue({
        data: statement({
          legs: [refundLeg],
          has_more: false,
          next_before: null,
          next_cursor: null,
        }),
        error: null,
      });
      render(<ChipStatement scope="player" />);
      expect(await screen.findByText('Tournament Refund')).toBeTruthy();
      await waitFor(() => expect(tournamentNames).toHaveBeenCalledTimes(1));
      await act(async () => {});
      expect(screen.getByText('From A Prize Pool')).toBeTruthy();
      expect(tournamentNames).toHaveBeenCalledTimes(1);
    });
  });
});
