/**
 * THE SETTLEMENT CENTER IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch S1, 2026-11-28)
 *
 * The Settlement Center (`/settlement-dashboard`) is moving from two painted
 * spade consoles to the arena workspace, and its retained ledger
 * (TransactionLedgerView) and its scope states (FinancialAdminScopeState) to
 * the arena dress. The condition on every page that prints money: no figure,
 * word, data hook, named region or control may change. This renders the real
 * page, the real ledger and the real scope state with synthetic reads, and
 * pins every printed figure (tests/helpers/moneyFigures.ts), the full printed
 * text, every named region and every control (with its disabled state) in each
 * state the page shows. The weekly workspace inside is pinned by
 * tests/components/weeklyAccountingFiguresArePinned.test.tsx, so it is a stub
 * here. The frame (console heads, the mast, the page help) is the part the pass
 * replaces, so the pin reads the bodies inside it and the page's own controls
 * other than the help "?". The pins were recorded against the old page and are
 * unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialAdminScope } from '../../src/hooks/useFinancialAdminScope';
import { moneyFigures } from '../helpers/moneyFigures';

const CLUB = 'c1000000-0000-4000-8000-000000000001';
const VIEWER = 'a1000000-0000-4000-8000-000000000001';
const OTHER = 'a2000000-0000-4000-8000-000000000002';

const backend = vi.hoisted(() => ({
  scope: null as unknown as FinancialAdminScope,
  userId: 'a1000000-0000-4000-8000-000000000001' as string | null,
  current: true,
  unions: false,
  rpc: vi.fn(),
  ledger: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('../../src/hooks/useFinancialAdminScope', () => ({
  useFinancialAdminScope: () => backend.scope,
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    user: backend.userId ? { id: backend.userId } : null,
    isHydrating: false,
  }),
}));
const scopeIsCurrent = () => backend.current;
vi.mock('../../src/hooks/useCashoutScope', () => ({
  useCashoutScope: () => scopeIsCurrent,
  useCashoutScopeKey: (accountId: string | undefined, view: string) =>
    JSON.stringify([accountId, view]),
}));
vi.mock('../../src/hooks/useCanCreateUnion', () => ({
  useCanOperateUnionNetwork: () => ({ canOperateUnionNetwork: backend.unions, checking: false }),
}));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: () => {},
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/accounting/WeeklyAccountingWorkspace', () => ({
  default: ({ scopeKind, scopeRef }: { scopeKind: string; scopeRef: string }) => (
    <div data-testid="weekly-stub">
      Weekly Workspace {scopeKind} {scopeRef === CLUB ? 'Kings Club' : 'Other'}
    </div>
  ),
}));
vi.mock('../../src/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'limit', 'eq', 'or']) query[method] = () => query;
  query.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
    (backend.ledger() as Promise<unknown>).then(done, fail);
  return {
    supabase: {
      rpc: (name: string, args: unknown) => backend.rpc(name, args),
      from: () => query,
    },
  };
});

import SettlementDashboardPage from '../../src/pages/SettlementDashboardPage';

function scope(over: Partial<FinancialAdminScope>): FinancialAdminScope {
  return {
    status: 'ready',
    clubId: CLUB,
    platformWide: false,
    clubRole: 'owner',
    isPlatformStaff: false,
    userId: VIEWER,
    message: null,
    reload: backend.reload,
    ...over,
  };
}

const row = (over: Record<string, unknown>) => ({
  id: 'r1',
  performed_by: VIEWER,
  from_type: 'club_treasury',
  from_entity_id: null,
  from_label: null,
  to_type: 'player_wallet',
  to_entity_id: OTHER,
  to_label: 'Lucky Seven',
  amount: 1250.75,
  category: 'transfer',
  description: 'Weekly Top Up',
  created_at: '2026-10-06T14:00:00.000Z',
  club_id: CLUB,
  union_id: null,
  ...over,
});

const ROWS = [
  row({ id: 'r1' }),
  row({
    id: 'r2',
    amount: 25,
    category: 'rake',
    from_type: 'table_stack',
    to_type: 'club_bank',
    to_entity_id: null,
    to_label: null,
    description: null,
    created_at: '2026-10-06T13:00:00.000Z',
  }),
  row({
    id: 'r3',
    amount: 400000.5,
    category: 'horse_funding',
    description: 'seat funded',
    created_at: '2026-10-06T12:00:00.000Z',
  }),
];

function clubLedger(rows: ReturnType<typeof row>[]) {
  return {
    contract: 'ca_club_chip_ledger.v2',
    contract_version: 2,
    club_id: CLUB,
    requested_limit: 25,
    requested_before: null,
    requested_include_hand_rows: false,
    hand_rows_included: false,
    rows,
  };
}

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

/** Every element inside a body a test, a screen reader or an e2e spec can name. */
function regions(root: Element): string[] {
  return [root, ...root.querySelectorAll('[aria-label], [role], [aria-live], ol, ul, time')].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-live') ?? ''}|${el.getAttribute('tabindex') ?? ''}`
  );
}

function controlName(el: Element): string {
  const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  return `${el.tagName.toLowerCase()}|${stable(name)}${disabled}`;
}

/** The bodies the frames hold: the ledger, the scope chooser, the weekly
 *  workspace and every state line. Outer matches only, in page order. */
const BODIES = [
  '.tlv',
  '.tlv-state',
  '[aria-label="Choose Accounting Scope"]',
  '[data-testid="weekly-stub"]',
  'p[role="alert"]',
  'p[role="status"]',
].join(', ');

function pin(container: HTMLElement) {
  const main = container.querySelector('main') as HTMLElement;
  const bodies = [...main.querySelectorAll(BODIES)].filter(
    (el, _, all) => !all.some((other) => other !== el && other.contains(el))
  );
  const lines = bodies.flatMap((body, index) => [
    `body ${index}: ${body.tagName.toLowerCase()}`,
    `money: ${JSON.stringify(moneyFigures(body as HTMLElement), null, 2)}`,
    `text: ${text(body)}`,
    `regions: ${JSON.stringify(regions(body), null, 2)}`,
  ]);
  // The page's own controls, by name: the help "?" belongs to the frame.
  const controls = [...main.querySelectorAll('button, a, input, select')]
    .filter((el) => !el.closest('.ca-page-help') && !el.classList.contains('ca-page-help'))
    .map(controlName)
    .sort();
  const named = ['Club Transaction Records', 'Your Account Transactions'].map(
    (name) => `${name}: ${main.querySelectorAll(`[aria-label="${name}"]`).length}`
  );
  return [...lines, `controls: ${JSON.stringify(controls, null, 2)}`, ...named, ''].join('\n');
}

function pinFile(name: string) {
  return `./__pins__/settlement-dashboard-${name}.pin.txt`;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/settlement-dashboard']}>
      <SettlementDashboardPage />
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
  backend.scope = scope({});
  backend.userId = VIEWER;
  backend.current = true;
  backend.unions = false;
  backend.rpc.mockReset().mockResolvedValue({ data: clubLedger(ROWS), error: null });
  backend.ledger.mockReset().mockResolvedValue({ data: [], error: null });
});

afterEach(cleanup);

describe('the Settlement Center prints the same figures, words and controls', () => {
  it('a club, its ledger loaded', async () => {
    const { container } = mount();
    await screen.findByText('Weekly Top Up');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('club-loaded'));
  });

  it('a club, its ledger empty', async () => {
    backend.rpc.mockResolvedValue({ data: clubLedger([]), error: null });
    const { container } = mount();
    await screen.findByText('No Transactions Yet');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('club-empty'));
  });

  it('a club, its ledger failed', async () => {
    backend.rpc.mockResolvedValue({ data: null, error: { message: 'Read Refused' } });
    const { container } = mount();
    await screen.findByText('The Club Ledger Could Not Be Loaded');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('club-failed'));
    // Try Again reads again.
    backend.rpc.mockResolvedValue({ data: clubLedger(ROWS), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await screen.findByText('Weekly Top Up');
  });

  it('a club, its ledger refused to this role', async () => {
    backend.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const { container } = mount();
    await screen.findByText(/This Ledger Is Available To Club Owners/);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('club-denied'));
  });

  it('a club, its ledger in flight', async () => {
    backend.rpc.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('club-busy'));
  });

  it('no club chosen, the account ledger and both directories', async () => {
    backend.scope = scope({ clubId: null, platformWide: true, clubRole: null });
    backend.unions = true;
    backend.ledger.mockResolvedValue({
      data: [row({ id: 'u1', club_id: null, to_entity_id: VIEWER, amount: 88.5 })],
      error: null,
    });
    const { container } = mount();
    await screen.findByText('Weekly Top Up');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('account'));
  });

  it('the account is not ready', async () => {
    backend.current = false;
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('unavailable'));
  });

  it.each(['loading', 'denied', 'error'] as const)('the finance scope is %s', async (status) => {
    backend.scope = scope({
      status,
      clubId: null,
      userId: null,
      message: status === 'denied' ? 'Your Role Does Not Include Finance Access.' : null,
    });
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile(`scope-${status}`));
  });
});
