/**
 * THE PLAYER STATISTICS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P3, 2026-11-28)
 *
 * The club Player Performance page (/clubs/:clubId/members/:userId/statistics)
 * is moving from its felt instrument dress to the arena workspace. The
 * condition on every page that prints figures: no figure, word, data hook,
 * named region or control may change. This renders the real page with
 * synthetic reads and pins every printed figure (tests/helpers/moneyFigures.ts),
 * the full printed text, every named region and every control (with its
 * pressed and disabled state) in each state the page shows: loaded, custom
 * range drafting, empty, restricted, not found, failed, a failed refresh over
 * kept figures, and busy (the first read, and a range read in flight).
 *
 * The page header is the one part the pass replaces, so the body is pinned
 * with the header and the back key taken out, and the header is pinned by its
 * one heading and the controls of the whole page in order. The snapshots were
 * recorded against the old page on main a3873e77f and are unchanged by the
 * pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const state = vi.hoisted(() => ({
  params: {
    clubId: 'shark-club',
    userId: '11111111-1111-4111-8111-111111111111',
  } as Record<string, string>,
  search: new URLSearchParams(),
  navigate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  getMemberStatistics: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => state.params,
  useSearchParams: () => [state.search, vi.fn()],
  useNavigate: () => state.navigate,
  useLocation: () => ({ state: null }),
  Link: ({ to, children, ...rest }: { to: string; children: unknown }) => (
    <a href={String(to)} {...rest}>
      {children as never}
    </a>
  ),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer-1' }, isHydrating: false }),
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => state.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useMasterBusBroadcastChannel', () => ({
  useMasterBusBroadcastChannel: vi.fn(),
}));
vi.mock('../../src/utils/strictClubIdResolver', () => ({
  ClubNotFoundError: class ClubNotFoundError extends Error {},
  resolveClubUUIDStrict: async () => '22222222-2222-4222-8222-222222222222',
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
vi.mock('../../src/services/ClubRosterService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/ClubRosterService')>(
    '../../src/services/ClubRosterService'
  );
  return {
    ...actual,
    default: { ...actual.default, getMemberStatistics: state.getMemberStatistics },
  };
});

import PlayerStatisticsPage from '../../src/pages/PlayerStatisticsPage';

const STATS = {
  authorized: true,
  reason: null,
  variant: 'all',
  variants: ['no_limit_holdem', 'pot_limit_omaha'],
  hands: 12345,
  hands_won: 2716,
  win_rate: 22,
  vpip: 31.2,
  pfr: 22.1,
  three_bet: 8.4,
  three_bets: 1037,
  fold_to_three_bet: 42,
  faced_three_bets: 120,
  cbet: 61,
  cbet_opportunities: 3100,
  net: -1234567.89,
  fees: 4321.05,
  from: '2026-08-08',
  to: '2026-09-06',
  is_overall: false,
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function mount() {
  return render(<PlayerStatisticsPage />);
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll(
      '[aria-label], [role], [aria-busy], [aria-live], label, h2, h3, details, section'
    ),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}|${el.getAttribute('aria-live') ?? ''}`
  );
}

/** Every control, with its label, value, pressed state and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a, summary')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const pressed = el.getAttribute('aria-pressed');
    const value =
      el.tagName === 'INPUT' || el.tagName === 'SELECT'
        ? ` =${(el as HTMLInputElement).value ? '<value>' : ''}`
        : '';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return `${el.tagName.toLowerCase()}|${name}${value}${pressed ? ` [pressed=${pressed}]` : ''}${disabled}`;
  });
}

function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words
    .join(' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The page below its header: the controls case, the alerts, the cards and
 *  the states. The header (and the back key it carried) is what the pass
 *  replaces, so it is pinned by its heading and the page's control order. */
function body(container: HTMLElement): HTMLElement {
  const page = container.querySelector('.player-stats-page') as HTMLElement;
  const copy = page.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('header, .ps-back').forEach((el) => el.remove());
  return copy;
}

function pin(container: HTMLElement) {
  const page = container.querySelector('.player-stats-page') as HTMLElement;
  const root = body(container);
  return {
    page: {
      busy: page.getAttribute('aria-busy'),
      heading: [...page.querySelectorAll('h1')].map((h) => `${h.id}|${h.textContent}`),
      controls: controls(page),
    },
    money: moneyFigures(root),
    text: text(root),
    regions: regions(root),
  };
}

beforeEach(() => {
  localStorage.clear();
  state.params = { clubId: 'shark-club', userId: '11111111-1111-4111-8111-111111111111' };
  state.search = new URLSearchParams();
  state.navigate.mockReset();
  state.toast.error.mockReset();
  state.getMemberStatistics.mockReset();
  state.getMemberStatistics.mockResolvedValue(STATS);
});

afterEach(() => cleanup());

describe('the Player Statistics page prints the same figures, words and controls', () => {
  it('loaded, a signed loss and a large sample', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Playing Style' });
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
            "31.2%",
            "22.1%",
            "3-Bet Per Hand",
            "8.4% (1,037)",
            "Fold To 3-Bet",
            "42.0% Of 120",
            "61.0% Of 3,100",
            "12,345",
            "2,716",
            "22.0%",
            "-1,234,567.89",
            "4,321.05",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
            "summary|Metric Definitions",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "details||Performance Metric Definitions||",
          "div|||false|",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom Showing <date> To <date> Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Playing Style VPIP 31.2% PFR 22.1% 3-Bet Per Hand 8.4% (1,037) Fold To 3-Bet 42.0% Of 120 C-Bet 61.0% Of 3,100 Volume Hands 12,345 Hands Won 2,716 Win Rate 22.0% Club Result Net -1,234,567.89 Fees 4,321.05",
      }
    `);
  });

  it('loaded over all recorded activity, a win, no 3-bets faced and no c-bet spots', async () => {
    state.getMemberStatistics.mockResolvedValue({
      ...STATS,
      is_overall: true,
      net: 120,
      fees: 18,
      faced_three_bets: 0,
      cbet_opportunities: 0,
    });
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Playing Style' });
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
            "31.2%",
            "22.1%",
            "3-Bet Per Hand",
            "8.4% (1,037)",
            "Fold To 3-Bet",
            "Never 3-Bet After Opening",
            "12,345",
            "2,716",
            "22.0%",
            "+120.00",
            "18.00",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
            "summary|Metric Definitions",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "details||Performance Metric Definitions||",
          "div|||false|",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom Showing All Recorded Activity Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Playing Style VPIP 31.2% PFR 22.1% 3-Bet Per Hand 8.4% (1,037) Fold To 3-Bet Never 3-Bet After Opening C-Bet No Flop Led As Aggressor Volume Hands 12,345 Hands Won 2,716 Win Rate 22.0% Club Result Net +120.00 Fees 18.00",
      }
    `);
  });

  it('a custom range with draft dates not yet applied', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Playing Style' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
            "31.2%",
            "22.1%",
            "3-Bet Per Hand",
            "8.4% (1,037)",
            "Fold To 3-Bet",
            "42.0% Of 120",
            "61.0% Of 3,100",
            "12,345",
            "2,716",
            "22.0%",
            "-1,234,567.89",
            "4,321.05",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=false]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=true]",
            "input| =<value>",
            "input| =<value>",
            "button|Confirm",
            "summary|Metric Definitions",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "label||||",
          "label||||",
          "p|status|Displayed Performance Scope||polite",
          "p|status|||",
          "details||Performance Metric Definitions||",
          "div|||false|",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom From To Confirm Showing <date> To <date> Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Draft Dates Not Applied. Confirm To Update The Displayed Range. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Playing Style VPIP 31.2% PFR 22.1% 3-Bet Per Hand 8.4% (1,037) Fold To 3-Bet 42.0% Of 120 C-Bet 61.0% Of 3,100 Volume Hands 12,345 Hands Won 2,716 Win Rate 22.0% Club Result Net -1,234,567.89 Fees 4,321.05",
      }
    `);
  });

  it('empty: no hands in this range', async () => {
    state.getMemberStatistics.mockResolvedValue({ ...STATS, hands: 0 });
    const { container } = mount();
    await screen.findByText('No Hands In This Range');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
            "summary|Metric Definitions",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "details||Performance Metric Definitions||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom Showing <date> To <date> Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Awaiting Hand Ledger No Hands In This Range All Variants Has No Recorded Hands For The Dates You Chose. Widen The Range Or Choose Another Game.",
      }
    `);
  });

  it('restricted', async () => {
    state.getMemberStatistics.mockResolvedValue({
      ...STATS,
      authorized: false,
      reason: 'forbidden',
      variants: [],
    });
    const { container } = mount();
    await screen.findByText('Statistics Restricted');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All Variants =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
        ],
        "text": "Instrument Controls Game All Variants Overall Day 7 Days Month Custom Showing <date> To <date> Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Awaiting Hand Ledger Statistics Restricted Your Club Role Does Not Permit Access To This Player's Private Performance Data.",
      }
    `);
  });

  it('not found', async () => {
    state.params = {};
    const { container } = mount();
    await screen.findByText('Member Not Found');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All Variants =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
        ],
        "text": "Instrument Controls Game All Variants Overall Day 7 Days Month Custom Showing ? To ? Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Awaiting Hand Ledger Member Not Found This Player Is Not A Member Of This Club.",
      }
    `);
  });

  it('failed first read', async () => {
    state.getMemberStatistics.mockRejectedValue(new Error('down'));
    const { container } = mount();
    await screen.findByText('Could Not Load Statistics');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All Variants =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
            "button|Try Again",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "div|alert|||",
        ],
        "text": "Instrument Controls Game All Variants Overall Day 7 Days Month Custom Showing ? To ? Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Statistics Connection Interrupted Could Not Load Statistics This Player's Statistics Are Still There. We Just Could Not Reach Them Right Now. Try Again",
      }
    `);
  });

  it('a failed refresh keeps the previous figures', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Playing Style' });
    state.getMemberStatistics.mockRejectedValueOnce(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: '7 Days' }));
    await screen.findByRole('alert');
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
            "31.2%",
            "22.1%",
            "3-Bet Per Hand",
            "8.4% (1,037)",
            "Fold To 3-Bet",
            "42.0% Of 120",
            "61.0% Of 3,100",
            "12,345",
            "2,716",
            "22.0%",
            "-1,234,567.89",
            "4,321.05",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "false",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=false]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=true]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
            "summary|Metric Definitions",
            "button|Try Again",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "details||Performance Metric Definitions||",
          "div|alert|||",
          "div|||false|",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom Showing <date> To <date> Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Statistics Connection Interrupted Could Not Refresh Statistics. The Figures Below Are From The Previous Successful Read. Try Again Playing Style VPIP 31.2% PFR 22.1% 3-Bet Per Hand 8.4% (1,037) Fold To 3-Bet 42.0% Of 120 C-Bet 61.0% Of 3,100 Volume Hands 12,345 Hands Won 2,716 Win Rate 22.0% Club Result Net -1,234,567.89 Fees 4,321.05",
      }
    `);
  });

  it('busy: the first read', async () => {
    state.getMemberStatistics.mockImplementation(() => new Promise(() => {}));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "true",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All Variants =",
            "button|Overall [pressed=true]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=false]",
            "button|Custom [pressed=false]",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "div|status|Loading content||",
        ],
        "text": "Instrument Controls Game All Variants Overall Day 7 Days Month Custom Showing ? To ? Chicago Time · All Variants Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm.",
      }
    `);
  });

  it('busy: a range read in flight over the previous figures', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Playing Style' });
    state.getMemberStatistics.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "money": {
          "figures": [
            "7 Days",
            "3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities.",
            "31.2%",
            "22.1%",
            "3-Bet Per Hand",
            "8.4% (1,037)",
            "Fold To 3-Bet",
            "42.0% Of 120",
            "61.0% Of 3,100",
            "12,345",
            "2,716",
            "22.0%",
            "-1,234,567.89",
            "4,321.05",
          ],
          "hooks": [],
        },
        "page": {
          "busy": "true",
          "controls": [
            "button|Go Back",
            "button|Page Help",
            "select|All VariantsNo Limit HoldemPot Limit Omaha =",
            "button|Overall [pressed=false]",
            "button|Day [pressed=false]",
            "button|7 Days [pressed=false]",
            "button|Month [pressed=true]",
            "button|Custom [pressed=false]",
            "summary|Metric Definitions",
          ],
          "heading": [
            "ps-page-title|Player Performance",
          ],
        },
        "regions": [
          "section||||",
          "h2||||",
          "label||||",
          "div|group|Statistics Date Range||",
          "p|status|Displayed Performance Scope||polite",
          "details||Performance Metric Definitions||",
          "div|||true|",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
          "section||||",
          "h2||||",
        ],
        "text": "Instrument Controls Game All Variants No Limit Holdem Pot Limit Omaha Overall Day 7 Days Month Custom Loading The Selected Range... Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm. Metric Definitions All Figures Use Recorded Hands For This Club, The Displayed Chicago Dates And Game. Older Activity May No Longer Be Retained. VPIP Counts Hands With Voluntary Preflop Investment; PFR Counts Hands With A Preflop Raise. Both Rates Divide By Hands Dealt. 3-Bet Per Hand Divides Three-Bet Hands By Hands Dealt, Not Three-Bet Opportunities. Fold To 3-Bet Divides Folds By Opens That Faced A Three-Bet. C-Bet Divides Flop Continuation Bets By Recorded Flop Continuation-Bet Opportunities. Hands Won Counts Hands With A Positive Net Result. Win Rate Divides Those Hands By Hands Dealt. Net Is The Cash Hand Result Plus Tournament Money (Prizes Paid Minus Buy-Ins) For The Selected Game, Matching The Win/Loss Card. Tournament Stack Chips Are Not Counted. Fees Sum Rake Paid. Neither Is A Wallet Balance. Playing Style VPIP 31.2% PFR 22.1% 3-Bet Per Hand 8.4% (1,037) Fold To 3-Bet 42.0% Of 120 C-Bet 61.0% Of 3,100 Volume Hands 12,345 Hands Won 2,716 Win Rate 22.0% Club Result Net -1,234,567.89 Fees 4,321.05",
      }
    `);
  });
});
