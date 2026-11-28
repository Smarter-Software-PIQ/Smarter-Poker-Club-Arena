/**
 * THE HAND ARCHIVE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P4, 2026-11-28)
 *
 * The Hand History page (`/hand-history`) is moving from the Play & Review
 * page bar to the arena workspace. The condition on every page that prints
 * money: no figure, word, data hook, named region or control may change. This
 * renders the real page with synthetic hands and pins every printed figure
 * (tests/helpers/moneyFigures.ts), the full printed text, every named region
 * and every control (with its disabled and pressed state) in each state the
 * page shows: loaded, a hand expanded, filtered to nothing, the tournament
 * view, opened from Player Stats, empty, failed, the first read in flight and
 * a Load More in flight. The header is the one part the pass replaces, so it
 * is pinned by its live figures only (the page bar's label and value pairs).
 * The hand rundown itself (HandDetailView), the flag and note controls and the
 * replay are table-layer surfaces with their own skin and their own tests;
 * they are stood in for here. The pins were recorded against the old page and
 * are unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const state = vi.hoisted(() => ({
  search: '',
  getHands: vi.fn(),
  getHand: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../src/hooks/useVIP', () => ({
  useVIPStatus: () => ({ isVIP: false, isLoading: false }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(state.search), vi.fn()],
  useLocation: () => ({ pathname: '/hand-history', search: state.search, hash: '' }),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: { id: 'hero' } }) }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => state.toast }));
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/utils/retryFetch', () => ({ retryFetch: (fn: () => unknown) => fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribe: () => () => {}, subscribeDebounced: () => () => {} },
}));
vi.mock('../../src/services/HandHistoryService', () => ({
  handHistoryService: {
    getPlayerHands: (...args: unknown[]) => state.getHands(...args),
    getHand: (...args: unknown[]) => state.getHand(...args),
  },
}));
vi.mock('../../src/services/HandNotesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/HandNotesService')>();
  return {
    ...actual,
    handNotesService: { ...actual.handNotesService, listFor: async () => new Map() },
  };
});
vi.mock('../../src/services/HandFlagService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/HandFlagService')>();
  return {
    ...actual,
    handFlagService: { ...actual.handFlagService, mineFor: async () => new Map() },
  };
});
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useSenderInviteCode', () => ({ useSenderInviteCode: () => null }));
vi.mock('../../src/components/handdetail/HandDetailView', () => ({
  default: () => <div>Hand Rundown</div>,
}));
vi.mock('../../src/components/handdetail/HandFlagControl', () => ({
  default: () => <div>Hand Flag</div>,
}));
vi.mock('../../src/components/handdetail/HandNoteEditor', () => ({
  default: () => <div>Hand Note</div>,
}));
vi.mock('../../src/components/replay/HandReplay', () => ({ default: () => <div>Replay</div> }));

import HandHistoryPage from '../../src/pages/HandHistoryPage';
import { replayFromServiceRecord } from '../../src/lib/handHistoryAdapter';
import type { HandRecord } from '../../src/services/HandHistoryService';

interface Spec {
  id: string;
  number: number;
  table: string;
  game: string;
  stakes: string;
  pot: number;
  heroResult: number;
  tournament?: string;
  asset?: 'chips' | 'diamonds';
}

function stored(spec: Spec): HandRecord {
  const hand = {
    id: spec.id,
    serial_number: spec.id,
    table_id: `table-${spec.table}`,
    table_name: spec.table,
    tournament_id: spec.tournament ?? null,
    arenaAsset: spec.asset ?? 'chips',
    played_at: '2026-10-20T12:00:00Z',
    hand_number: spec.number,
    total_hands: 1,
    main_pot: spec.pot,
    side_pots: [],
    community_cards: [],
    players: [
      {
        user_id: 'hero',
        username: 'Hero',
        seat: 1,
        position: 'SB',
        hole_cards: [],
        result: spec.heroResult,
        is_winner: spec.heroResult > 0,
      },
      {
        user_id: 'villain',
        username: 'River Rat',
        seat: 2,
        position: 'BB',
        hole_cards: [],
        result: -spec.heroResult,
        is_winner: spec.heroResult < 0,
      },
    ],
    actions: [{ player_id: 'hero', action: 'raise', amount: 6, street: 'preflop', timestamp: 1 }],
    winners: [
      { user_id: spec.heroResult >= 0 ? 'hero' : 'villain', amount: spec.pot, pot_index: 0 },
    ],
    winners_by_board: [],
    game_type: spec.game,
    stakes: spec.stakes,
    rake: 0,
    bbj_fee: 0,
  } as unknown as HandRecord;
  hand.replay = replayFromServiceRecord(hand);
  return hand;
}

const HANDS = [
  stored({
    id: 'h3',
    number: 1203,
    table: 'Kings Den',
    game: 'NLH',
    stakes: '1/2',
    pot: 1250.75,
    heroResult: 625.25,
  }),
  stored({
    id: 'h2',
    number: 1202,
    table: 'Kings Den',
    game: 'PLO',
    stakes: '2/5',
    pot: 88.5,
    heroResult: -44.25,
  }),
  stored({
    id: 'h1',
    number: 1201,
    table: 'River Room',
    game: 'NLH',
    stakes: '0.5/1',
    pot: 3,
    heroResult: 0,
    asset: 'diamonds',
  }),
];

const EVENT_HANDS = [
  stored({
    id: 't1',
    number: 40,
    table: 'Sunday Major',
    game: 'NLH',
    stakes: '100/200',
    pot: 4800,
    heroResult: 2400,
    tournament: 'event-1',
  }),
];

const FULL_PAGE = Array.from({ length: 25 }, (_, i) =>
  stored({
    id: `p${i}`,
    number: 900 - i,
    table: 'Kings Den',
    game: 'NLH',
    stakes: '1/2',
    pot: 10 + i,
    heroResult: i % 2 === 0 ? 5 : -5,
  })
);

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
    ...root.querySelectorAll('[aria-label], [role], [aria-busy], label, h2, h3, article'),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}`
  );
}

/** Every control, with its label, pressed/expanded state and whether it can be pressed. */
function controls(root: Element): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const pressed = el.getAttribute('aria-pressed');
    const expanded = el.getAttribute('aria-expanded');
    const name =
      el.getAttribute('aria-label') ??
      (el.tagName === 'INPUT'
        ? (el.getAttribute('placeholder') ?? el.getAttribute('type'))
        : null) ??
      el.textContent?.replace(/\s+/g, ' ').trim() ??
      '';
    return `${el.tagName.toLowerCase()}|${stable(name)}${pressed ? ` [pressed=${pressed}]` : ''}${
      expanded ? ` [expanded=${expanded}]` : ''
    }${disabled}`;
  });
}

/** The page's live figures, however the header around them is built. */
function headerFigures(page: Element): string[] {
  return [...page.querySelectorAll('.ca-page-bar dt, .ca-page-bar dd')].map(
    (el) => `${el.tagName.toLowerCase()}|${el.textContent?.trim() ?? ''}`
  );
}

/** The page below its header. The header is what the pass replaces. */
function body(page: Element): Element {
  const copy = page.cloneNode(true) as Element;
  copy
    .querySelectorAll(':scope > header, :scope > .ca-page-bar, :scope > .ca-page-help')
    .forEach((el) => el.remove());
  return copy;
}

function pin(container: HTMLElement) {
  const page = container.querySelector('.hand-history-page') as Element;
  const root = body(page);
  return [
    `header figures: ${JSON.stringify(headerFigures(page), null, 2)}`,
    `money: ${JSON.stringify(moneyFigures(root as HTMLElement), null, 2)}`,
    `text: ${text(root)}`,
    `regions: ${JSON.stringify(regions(root), null, 2)}`,
    `controls: ${JSON.stringify(controls(root), null, 2)}`,
    '',
  ].join('\n');
}

function pinFile(name: string) {
  return `./__pins__/hand-history-${name}.pin.txt`;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  state.search = '';
  state.getHands.mockReset().mockResolvedValue(HANDS);
  state.getHand.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Hand Archive prints the same figures, words and controls', () => {
  it('loaded', async () => {
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('#1203');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loaded'));
  });

  it('a hand expanded', async () => {
    const { container } = render(<HandHistoryPage />);
    fireEvent.click((await screen.findByText('#1203')).closest('button') as HTMLElement);
    await screen.findByText('Open Hand Detail');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('expanded'));
  });

  it('filtered to nothing', async () => {
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('#1203');
    fireEvent.change(screen.getByPlaceholderText('Hand Number, Opponent, Tag Or Note'), {
      target: { value: 'nobody-plays-here' },
    });
    await screen.findByText('No Loaded Hands Match That Search');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('filtered'));
  });

  it('the tournament view', async () => {
    state.search = '?gameMode=tournament';
    state.getHands.mockResolvedValue(EVENT_HANDS);
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('#40');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('tournament'));
  });

  it('opened from Player Stats', async () => {
    state.search = '?source=stats';
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('#1203');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('from-stats'));
  });

  it('empty', async () => {
    state.getHands.mockResolvedValue([]);
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('No Hands Recorded Yet');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('failed', async () => {
    state.getHands.mockRejectedValue(new Error('Read Refused'));
    const { container } = render(<HandHistoryPage />);
    await screen.findByText('Could Not Load Your Hand History');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('the first read in flight', async () => {
    state.getHands.mockReturnValue(new Promise(() => {}));
    const { container } = render(<HandHistoryPage />);
    await settle();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    await expect(pin(container)).toMatchFileSnapshot(pinFile('busy'));
  });

  it('a Load More in flight', async () => {
    state.getHands.mockResolvedValueOnce(FULL_PAGE).mockReturnValue(new Promise(() => {}));
    const { container } = render(<HandHistoryPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load More Hands' }));
    await screen.findByRole('button', { name: 'Loading' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('paging'));
  });
});
