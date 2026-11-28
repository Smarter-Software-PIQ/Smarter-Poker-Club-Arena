/**
 * THE TRANSACTION LEDGER IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P4, 2026-11-28)
 *
 * The Transaction History page (`/transactions`) is moving from the Rewards
 * Circuit page bar to the arena workspace, and its chip statement from the
 * painted riveted console to the arena case. The condition on every page that
 * prints money: no figure, word, data hook, named region or control may
 * change. This renders the real page, the real chip statement and the real
 * rakeback week with synthetic reads, and pins every printed figure
 * (tests/helpers/moneyFigures.ts), the full printed text, every named region
 * and every control (with its disabled state) in each state the page shows:
 * loaded with earlier movements to read, an earlier page in flight, empty,
 * failed, the first read in flight, and the Diamond history door. The header
 * is the one part the pass replaces, so the pin starts below it. The pins were
 * recorded against the old page and are unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const backend = vi.hoisted(() => ({
  statement: vi.fn(),
  week: vi.fn(),
  route: '/transactions',
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer' }, isHydrating: false }),
}));
// One stable guard, as the real hook returns.
const scopeIsCurrent = () => true;
vi.mock('../../src/hooks/useCashoutScope', () => ({
  useCashoutScope: () => scopeIsCurrent,
  useCashoutScopeKey: (accountId: string | undefined, view: string) =>
    JSON.stringify([accountId, view]),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/tournament/TournamentPaymentStatus', () => ({
  default: () => <div>Tournament Payments</div>,
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribeDebounced: () => () => {} },
}));
vi.mock('../../src/lib/supabase', () => {
  const names = {
    select: () => names,
    in: async () => ({ data: [{ id: 't', name: 'Sunday Major' }], error: null }),
  };
  return {
    supabase: {
      rpc: (name: string, args: unknown) =>
        name === 'fn_my_rakeback_week_so_far' ? backend.week(args) : backend.statement(args),
      from: () => names,
    },
  };
});
vi.mock('../../src/components/arena/DiamondArenaWallet', () => ({
  default: ({ initialOpen }: { initialOpen?: boolean }) => (
    <div role="dialog" aria-label="Diamond History">
      {initialOpen ? 'Own Diamond History' : 'Closed Diamond History'}
    </div>
  ),
}));

import TransactionHistoryPage from '../../src/pages/TransactionHistoryPage';

const ACCOUNT = 'player_wallet:viewer:club_members.chip_balance';

const leg = (over: Record<string, unknown>) => ({
  id: 'l1',
  at: '2026-10-06T12:00:00.000000+00:00',
  direction: 'in',
  amount: 40,
  category: 'tournament_prize',
  description: null,
  counterparty_type: 'prize_liability',
  counterparty_label: null,
  counterparty_id: 't',
  club_id: 'c',
  table_id: null,
  tournament_id: 't',
  hand_id: null,
  settlement_id: null,
  ...over,
});

const LEGS = [
  leg({ id: 'l4', at: '2026-10-06T14:00:00.000000+00:00', amount: 1250.75 }),
  leg({
    id: 'l3',
    at: '2026-10-06T13:00:00.000000+00:00',
    direction: 'out',
    amount: 25,
    category: 'tournament_buyin',
  }),
  leg({
    id: 'l2',
    at: '2026-10-06T12:30:00.000000+00:00',
    direction: 'in',
    amount: 300,
    category: 'transfer',
    counterparty_type: 'club_treasury',
    tournament_id: null,
  }),
];

function statement(legs: ReturnType<typeof leg>[], more: boolean) {
  const last = legs[legs.length - 1];
  return {
    scope: 'player',
    entity_id: 'viewer',
    account: ACCOUNT,
    club_filter: null,
    balance_now: 25525.75,
    balance_exists: true,
    clubs: [
      { club_id: 'c', club_name: 'Kings Club', balance: 25000 },
      { club_id: 'd', club_name: 'deep stack', balance: 525.75 },
    ],
    legs,
    has_more: more,
    next_before: more ? last.at : null,
    next_cursor: more
      ? { at: last.at, id: last.id, direction: last.direction, account: ACCOUNT, club_filter: null }
      : null,
    audit: {
      status: 'reconciles',
      read_at: '2026-10-06T06:40:00Z',
      balance_at_reading: 24000,
      in_since: 1550.75,
      out_since: 25,
      legs_since: 3,
      expected_now: 25525.75,
      balance_now: 25525.75,
      unexplained: 0,
    },
    generated_at: '2026-10-06T15:05:00Z',
    ms: 12,
  };
}

const WEEK = {
  week_start: '2026-10-05',
  week_end: '2026-10-11',
  paid_at: '2026-10-12T07:00:00Z',
  clubs: [
    {
      club_id: 'c',
      club_name: 'Kings Club',
      rake_recorded: 412.5,
      cash_rake: 400,
      tournament_rake: 12.5,
      estimated_rakeback: 123.75,
      current_rate_pct: 30,
      last_recorded_at: '2026-10-06T13:00:00Z',
    },
  ],
};

/** Dates and clock times follow the zone the test runs in; a frame cannot
 *  break them, so they print as tokens (as tests/helpers/moneyFigures.ts does). */
function stable(value: string): string {
  return value
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '<date>')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

function text(root: Element): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return stable(words.join(' '));
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: Element): string[] {
  return [
    ...root.querySelectorAll(
      '[aria-label], [role], [aria-busy], [data-scope], h2, h3, ol, ul, time, footer'
    ),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}`
  );
}

/** Every control, with its label and whether it can be pressed. */
function controls(root: Element): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return `${el.tagName.toLowerCase()}|${stable(name)}|${stable(el.textContent ?? '')}${disabled}`;
  });
}

function pin(container: HTMLElement) {
  const root = container.querySelector('.transaction-history-page__statement') as HTMLElement;
  return [
    `money: ${JSON.stringify(moneyFigures(root), null, 2)}`,
    `text: ${text(root)}`,
    `regions: ${JSON.stringify(regions(root), null, 2)}`,
    `controls: ${JSON.stringify(controls(root), null, 2)}`,
    '',
  ].join('\n');
}

function pinFile(name: string) {
  return `./__pins__/transaction-history-${name}.pin.txt`;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={[backend.route]}>
      <TransactionHistoryPage />
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.route = '/transactions';
  backend.statement.mockReset().mockResolvedValue({ data: statement(LEGS, true), error: null });
  backend.week.mockReset().mockResolvedValue({ data: WEEK, error: null });
});

afterEach(cleanup);

describe('the Transaction Ledger prints the same figures, words and controls', () => {
  it('loaded, with earlier movements to read', async () => {
    const { container } = mount();
    await screen.findByText('Tournament Prize');
    await screen.findByText('Rakeback This Week So Far');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loaded'));
  });

  it('an earlier page in flight', async () => {
    const { container } = mount();
    await screen.findByText('Tournament Prize');
    backend.statement.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Load Earlier Movements' }));
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('paging'));
  });

  it('empty', async () => {
    backend.statement.mockResolvedValue({ data: statement([], false), error: null });
    backend.week.mockResolvedValue({ data: { ...WEEK, clubs: [] }, error: null });
    const { container } = mount();
    await screen.findByText('No Chip Movements Yet.');
    await screen.findByText('No Raked Hands Recorded For You This Week Yet.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('failed', async () => {
    backend.statement.mockResolvedValue({ data: null, error: { message: 'Read Refused' } });
    backend.week.mockResolvedValue({ data: null, error: { message: 'Read Refused' } });
    const { container } = mount();
    await screen.findByText('This Week Is Unavailable Right Now.');
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('the first read in flight', async () => {
    backend.statement.mockReturnValue(new Promise(() => {}));
    backend.week.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('busy'));
  });

  it('the Diamond history door', async () => {
    backend.route = '/transactions?club=diamond-arena';
    const { container } = mount();
    await screen.findByText('Own Diamond History');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('diamond'));
  });
});
