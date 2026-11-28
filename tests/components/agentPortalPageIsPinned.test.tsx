/**
 * THE AGENT PORTAL IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch A2, 2026-11-28)
 *
 * The Agent Portal (`/agent-portal`) is moving from two painted spade consoles,
 * the painted Credit Invoices console (AgentInvoicesPanel) and the painted
 * ledger to the arena workspace. The condition on every page that prints
 * money: no figure, word, data hook, named region or control may change. This
 * renders the real page, the real invoices panel and the real ledger with
 * synthetic reads and pins every printed figure (tests/helpers/moneyFigures.ts),
 * the printed text in order, every named region and every control (with its
 * disabled state) in each state the page shows.
 *
 * The frame is the part the pass replaces, so the pin reads the page without
 * it: the painted console heads (title, eyebrow, pill), the page bar, the mast,
 * the chrome "?", the page h1 (hidden before, the mast after), every h2 (a
 * console title before, a case title after) and the
 * case status notes that stand where the pills stood. The pins were recorded
 * against the old page and are unchanged by the pass.
 *
 * Dates are fixed mid-month and mid-day (Date only is faked), so the commission
 * weekdays and the invoice dates read the same under UTC and America/Chicago.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const VIEWER = '10000000-0000-4000-8000-000000000001';
const CLUB = '20000000-0000-4000-8000-000000000001';
const AGENT = '30000000-0000-4000-8000-000000000001';

const backend = vi.hoisted(() => ({
  agents: vi.fn(),
  member: vi.fn(),
  commissions: vi.fn(),
  ledger: vi.fn(),
  debt: vi.fn(),
  invoices: vi.fn(),
  pay: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'or', 'in'])
        q[method] = () => q;
      q.maybeSingle = () =>
        table === 'agents' ? backend.agents() : table === 'club_members' ? backend.member() : null;
      q.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
        Promise.resolve(
          table === 'agent_commissions' ? backend.commissions() : backend.ledger()
        ).then(done, fail);
      return q;
    },
  },
}));
vi.mock('../../src/services/CreditService', () => ({
  CreditService: {
    calculateDebt: () => backend.debt(),
    getAgentInvoices: () => backend.invoices(),
    processPayment: (...args: unknown[]) => backend.pay(...args),
  },
  // The same three statuses as src/services/CreditService.ts.
  OWED_INVOICE_STATUSES: new Set(['pending', 'partial', 'overdue']),
}));
vi.mock('../../src/services/WalletService', () => ({
  WalletService: { agentSelfTransfer: vi.fn() },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: '10000000-0000-4000-8000-000000000001' } }),
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: (state: { currentClubId: string }) => unknown) =>
    selector({ currentClubId: '20000000-0000-4000-8000-000000000001' }),
}));
vi.mock('../../src/utils/clubIdResolver', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/clubIdResolver')>(
    '../../src/utils/clubIdResolver'
  );
  return { ...actual, resolveClubUUID: async (id: string) => id };
});
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: () => {},
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    emit: vi.fn(),
    subscribeDebounced: () => () => undefined,
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: () => {
      const channel: Record<string, unknown> = {};
      channel.on = () => channel;
      channel.subscribe = () => channel;
      return channel;
    },
  },
}));

import AgentPortalPage from '../../src/pages/AgentPortalPage';

const NOW = new Date('2026-10-15T18:00:00.000Z');

function invoice(status: string, id: string, amountRemaining: number, amountPaid = 0) {
  return {
    id,
    agentId: AGENT,
    agentName: 'Agent',
    periodStart: '2026-10-05T17:00:00.000Z',
    periodEnd: '2026-10-11T17:00:00.000Z',
    debtOwed: 1599.99,
    amountPaid,
    amountRemaining,
    status,
    dueDate: '2026-10-14T17:00:00.000Z',
    createdAt: '2026-10-12T17:00:00.000Z',
  };
}

const INVOICES = [
  invoice('pending', 'i1', 1299.99, 300),
  invoice('overdue', 'i2', 1599.99),
  invoice('disputed', 'i3', 25.5),
  invoice('paid', 'i4', 0, 1599.99),
  invoice('void', 'i5', 0),
];

const COMMISSIONS = [
  { amount: 12.5, created_at: '2026-10-13T17:00:00.000Z' },
  { amount: 1250.25, created_at: '2026-10-13T18:00:00.000Z' },
  { amount: 400000, created_at: '2026-10-14T17:00:00.000Z' },
];

const LEDGER = [
  {
    id: 'l1',
    performed_by: VIEWER,
    from_type: 'agent_wallet',
    from_entity_id: VIEWER,
    from_label: null,
    to_type: 'player_wallet',
    to_entity_id: VIEWER,
    to_label: null,
    amount: 75.25,
    category: 'transfer',
    description: 'Agent Self Transfer',
    created_at: '2026-10-14T17:00:00.000Z',
    club_id: CLUB,
    union_id: null,
  },
];

const ok = <T,>(data: T) => ({ data, error: null });

/** The frame the pass replaces: console heads, page bar, mast, "?", every
 *  section title and the case notes that stand where the pills stood. */
const FRAME = [
  '.sc__head',
  '.ca-page-bar',
  '.arena-workspace-mast',
  '.ca-page-help',
  'h1',
  'h2',
  '.agent-portal__status',
  '.agent-invoices-arena__status',
].join(', ');

function normalize(text: string): string {
  return text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

function control(el: Element): string {
  const name = normalize(el.getAttribute('aria-label') || el.textContent || '');
  const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
  const title = el.getAttribute('title') ? ` title=${el.getAttribute('title')}` : '';
  return `${el.tagName.toLowerCase()}|${name}${disabled}${title}`;
}

function pin(container: HTMLElement): string {
  const main = container.querySelector('main') as HTMLElement;
  const body = main.cloneNode(true) as HTMLElement;
  for (const el of body.querySelectorAll(FRAME)) el.remove();
  const controls = [...body.querySelectorAll('button, a[href], input, select, textarea')]
    .map(control)
    .sort();
  const words = body.cloneNode(true) as HTMLElement;
  for (const el of words.querySelectorAll('button, a[href]')) el.remove();
  const text: string[] = [];
  const walker = words.ownerDocument.createTreeWalker(words, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const piece = normalize(walker.currentNode.textContent ?? '');
    if (piece) text.push(piece);
  }
  const regions = [...body.querySelectorAll('[aria-label], [role], [aria-live], ol, ul')].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-live') ?? ''}`
  );
  return [
    `money: ${JSON.stringify(moneyFigures(body), null, 2)}`,
    `text: ${text.join(' | ')}`,
    `regions: ${JSON.stringify(regions, null, 2)}`,
    `controls: ${JSON.stringify(controls, null, 2)}`,
    `named: ${['Agent Wallets', 'Credit Line', 'Agent Invoices', 'My Transactions']
      .map((name) => `${name}=${main.querySelectorAll(`[aria-label="${name}"]`).length}`)
      .join(', ')}`,
    '',
  ].join('\n');
}

const pinFile = (name: string) => `./__pins__/agent-portal-${name}.pin.txt`;

function mount() {
  return render(
    <MemoryRouter initialEntries={['/agent-portal']}>
      <AgentPortalPage />
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await new Promise((done) => setTimeout(done, 450));
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  backend.agents.mockReset().mockResolvedValue(
    ok({
      id: AGENT,
      club_id: CLUB,
      agent_wallet_balance: 1250.5,
      promo_wallet_balance: 40,
      credit_limit: 20000,
    })
  );
  backend.member.mockReset().mockResolvedValue(ok({ chip_balance: 456 }));
  backend.debt.mockReset().mockResolvedValue({
    creditLimit: 20000,
    debtOwed: 75.23,
    isPrepaid: false,
  });
  backend.commissions.mockReset().mockReturnValue(ok(COMMISSIONS));
  backend.ledger.mockReset().mockReturnValue(ok(LEDGER));
  backend.invoices.mockReset().mockResolvedValue(INVOICES);
  backend.pay.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Agent Portal prints the same figures, words and controls', () => {
  it('reading the wallets', async () => {
    backend.agents.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('reading'));
  });

  it('ready: wallets, a shortfall, invoices, commissions and the ledger', async () => {
    const { container } = mount();
    await screen.findByText('Agent Self Transfer');
    await screen.findByRole('list', { name: 'Credit Invoice History' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('ready'));
  });

  it('ready and prepaid: no invoices, no commissions, an empty ledger', async () => {
    backend.debt.mockResolvedValue({ creditLimit: 0, debtOwed: 0, isPrepaid: true });
    backend.invoices.mockResolvedValue([]);
    backend.commissions.mockReturnValue(ok([]));
    backend.ledger.mockReturnValue(ok([]));
    const { container } = mount();
    await screen.findByText(/No Invoices\./);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('prepaid-empty'));
  });

  it('the wallet cannot be verified', async () => {
    backend.member.mockResolvedValue({ data: null, error: new Error('Member Read Refused') });
    const { container } = mount();
    await screen.findByRole('button', { name: /Open Clubs/ });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('wallet-failed'));
  });

  it('the commission history fails', async () => {
    backend.commissions.mockReturnValue({
      data: null,
      error: new Error('Commission Read Refused'),
    });
    const { container } = mount();
    await screen.findByText(/Commission Read Refused/);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('commission-failed'));
  });

  it('the invoices and the ledger are unavailable', async () => {
    backend.invoices.mockResolvedValue(null);
    backend.ledger.mockReturnValue({ data: null, error: { message: 'Ledger Read Refused' } });
    const { container } = mount();
    await screen.findByText(/Invoices Unavailable/);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('invoices-ledger-failed'));
  });

  it('an invoice payment in flight', async () => {
    backend.pay.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pay Now' }))[0]);
    await screen.findByRole('button', { name: 'Paying...' });
    await settle();
    expect(backend.pay).toHaveBeenCalledWith('i1', 1299.99, 'wallet', expect.anything());
    await expect(pin(container)).toMatchFileSnapshot(pinFile('paying'));
  });

  it('Transfer To Play opens the same transfer dialog', async () => {
    mount();
    await screen.findByText('Agent Self Transfer');
    fireEvent.click(screen.getByRole('button', { name: /Transfer To Play/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Transfer To Play Wallet' });
    expect(dialog).toHaveTextContent('Available: 1,250.50 Chips');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
  });
});
