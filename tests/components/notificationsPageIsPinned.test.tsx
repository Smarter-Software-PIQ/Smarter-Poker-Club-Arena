/**
 * THE NOTIFICATIONS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P1, 2026-11-28)
 *
 * The Notifications page is moving from its Signal Desk dress to the arena
 * workspace. The condition on every page that prints counts: no figure, word,
 * data hook, named region or control may change. This renders the real page
 * with synthetic reads and pins every printed figure
 * (tests/helpers/moneyFigures.ts), the full printed text, every named region
 * and every control (with its disabled state) in each state the page shows:
 * loaded, the Unread filter cleared, empty, failed and busy (the first load,
 * and a dismissal in flight). The page header is pinned by its status line
 * only: the header is the one part the pass replaces. The snapshots were
 * recorded against the old page on main e6aa72113 and are unchanged by the
 * pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const fixture = vi.hoisted(() => ({
  user: { id: 'account-a' } as { id: string } | null,
  getSession: vi.fn(),
  fetch: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: fixture.user }) }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/components/notifications/PushEnableBanner', () => ({ default: () => null }));
vi.mock('../../src/lib/openExternal', () => ({ leaveForHub: vi.fn(), openInBrowser: vi.fn() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    emit: fixture.emit,
    getOrCreateChannel: (name: string) => {
      const channel: any = { name, state: 'closed' };
      channel.on = () => channel;
      channel.subscribe = () => channel;
      return channel;
    },
    registerChannelFactory: vi.fn(),
    removeChannelFactory: vi.fn(),
    removeRegisteredChannel: vi.fn(),
  },
}));
vi.mock('../../src/lib/subscribeRealtime', () => ({ subscribeRealtime: () => {} }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: fixture.getSession } },
}));

import NotificationsPage from '../../src/pages/NotificationsPage';

const NOW = new Date('2026-11-20T15:00:00');

function feedRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'account-a',
    title: 'Tournament',
    actor_name: 'Tournament',
    message: id,
    created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    read: false,
    link: '/hub/club-arena/tournaments/event',
    ...over,
  };
}

const ROWS = [
  feedRow('seat-call', {
    type: 'seat_open',
    actor_name: 'Kings Club',
    message: 'A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.',
  }),
  feedRow('settled', {
    type: 'settlement',
    title: 'Settlement',
    actor_name: null,
    message: 'Week 47 Settled: 1,250.75 Chips Credited.',
    read: true,
    created_at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
  }),
  feedRow('friend', {
    type: 'friend_request',
    actor_name: 'River Rat',
    actor_avatar_url: 'https://example.test/a.png',
    message: 'Sent You A Friend Request.',
    read: true,
    link: null,
    created_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  }),
];

const response = (rows: unknown[] = [], ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: async () => ({ success: ok, notifications: rows }),
});

let feed: () => Promise<unknown>;
let remove: () => Promise<unknown>;

function mount() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll('[aria-label], [role], [aria-busy], label, h2, h3, h4, article'),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}`
  );
}

/** Every control, with its label, pressed state and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const pressed = el.getAttribute('aria-pressed');
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return `${el.tagName.toLowerCase()}|${name}${pressed ? ` [pressed=${pressed}]` : ''}${disabled}`;
  });
}

function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** The page below its header: the filter and action bar, the alerts and the
 *  list. The header is replaced by the pass, so it is pinned by its status. */
function body(container: HTMLElement): HTMLElement {
  const page = container.querySelector('.ca-notif') as HTMLElement;
  const copy = page.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('header, .ca-page-bar').forEach((el) => el.remove());
  return copy;
}

function pin(container: HTMLElement) {
  const root = body(container);
  return {
    money: moneyFigures(root),
    text: text(root),
    regions: regions(root),
    controls: controls(root),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  localStorage.clear();
  fixture.user = { id: 'account-a' };
  fixture.getSession.mockImplementation(async () => ({
    data: { session: { user: { id: 'account-a' }, access_token: 'token-a' } },
  }));
  feed = async () => response(ROWS);
  remove = async () => response();
  fixture.fetch.mockImplementation((url: string) => {
    if (url.includes('/feed?')) return feed();
    if (url === '/api/notifications/delete') return remove();
    return Promise.resolve(response());
  });
  vi.stubGlobal('fetch', fixture.fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Notifications page prints the same figures, words and controls', () => {
  it('loaded', async () => {
    const { container } = mount();
    await flush();
    expect(screen.queryByText('Connecting')).not.toBeNull();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 3 [pressed=true]",
          "button|Unread 1 [pressed=false]",
          "button|Alert Controls",
          "button|Mark All Read",
          "button|Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m",
          "button|Dismiss Tournament",
          "button|Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h",
          "button|Dismiss Settlement",
          "button|River Rat Sent You A Friend Request.2d (disabled)",
          "button|Dismiss Tournament",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.",
            "5m",
            "Week 47 Settled: 1,250.75 Chips Credited.",
            "3h",
            "2d",
          ],
          "hooks": [
            "data-notif-id=seat-call",
            "data-notif-id=settled",
            "data-notif-id=friend",
          ],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "h2||Today Notifications|",
          "article|||",
          "button||Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m|",
          "span||Unread|",
          "button||Dismiss Tournament|",
          "article|||",
          "button||Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h|",
          "button||Dismiss Settlement|",
          "h2||This Week Notifications|",
          "article|||",
          "button||Dismiss Tournament|",
        ],
        "text": "All 3 Unread 1 Alert Controls Mark All Read Today Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left. 5m Settlement Week 47 Settled: 1,250.75 Chips Credited. 3h This Week River Rat Sent You A Friend Request. 2d",
      }
    `);
  });

  it('the Unread filter with every signal read', async () => {
    feed = async () => response(ROWS.map((r) => ({ ...r, read: true })));
    const { container } = mount();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 3 [pressed=false]",
          "button|Unread 0 [pressed=true]",
          "button|Alert Controls",
          "button|View All Notifications",
        ],
        "money": {
          "figures": [
            "3",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "div|status||",
          "h3|||",
        ],
        "text": "All 3 Unread 0 Alert Controls All Signals Cleared There Are No Unread Notifications. View All Notifications",
      }
    `);
  });

  it('empty', async () => {
    feed = async () => response([]);
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 0 [pressed=true]",
          "button|Unread 0 [pressed=false]",
          "button|Alert Controls",
        ],
        "money": {
          "figures": [
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "h3|||",
        ],
        "text": "All 0 Unread 0 Alert Controls No Signals Yet Seat Calls, Tournament Starts, Settlements, Friend Requests And Club Announcements Will Land Here.",
      }
    `);
  });

  it('failed', async () => {
    fixture.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Session Read Refused'),
    });
    const { container } = mount();
    await flush();
    expect(screen.queryByText('Refresh Needed')).not.toBeNull();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 0 [pressed=true]",
          "button|Unread 0 [pressed=false]",
          "button|Alert Controls",
          "button|Try Again",
        ],
        "money": {
          "figures": [
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "div|alert||",
        ],
        "text": "All 0 Unread 0 Alert Controls Notifications Could Not Be Loaded. Try Again",
      }
    `);
  });

  it('busy: the first load', async () => {
    feed = () => new Promise(() => {});
    const { container } = mount();
    await flush();
    expect(screen.queryByText('Synchronizing')).not.toBeNull();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 0 [pressed=true]",
          "button|Unread 0 [pressed=false]",
          "button|Alert Controls",
        ],
        "money": {
          "figures": [
            "0",
            "0",
          ],
          "hooks": [],
        },
        "regions": [
          "div|group|Filter Notifications|",
        ],
        "text": "All 0 Unread 0 Alert Controls",
      }
    `);
  });

  it('busy: a dismissal in flight, then refused', async () => {
    let refuse!: () => void;
    remove = () =>
      new Promise((resolve) => {
        refuse = () => resolve(response([], false));
      });
    const { container } = mount();
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: /^Dismiss / })[0]);
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 3 [pressed=true]",
          "button|Unread 1 [pressed=false]",
          "button|Alert Controls",
          "button|Mark All Read",
          "button|Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m",
          "button|Dismiss Tournament (disabled)",
          "button|Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h",
          "button|Dismiss Settlement",
          "button|River Rat Sent You A Friend Request.2d (disabled)",
          "button|Dismiss Tournament",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.",
            "5m",
            "Week 47 Settled: 1,250.75 Chips Credited.",
            "3h",
            "2d",
          ],
          "hooks": [
            "data-notif-id=seat-call",
            "data-notif-id=settled",
            "data-notif-id=friend",
          ],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "h2||Today Notifications|",
          "article|||true",
          "button||Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m|",
          "span||Unread|",
          "button||Dismiss Tournament|",
          "article|||",
          "button||Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h|",
          "button||Dismiss Settlement|",
          "h2||This Week Notifications|",
          "article|||",
          "button||Dismiss Tournament|",
        ],
        "text": "All 3 Unread 1 Alert Controls Mark All Read Today Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left. 5m Settlement Week 47 Settled: 1,250.75 Chips Credited. 3h This Week River Rat Sent You A Friend Request. 2d",
      }
    `);
    await act(async () => refuse());
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|All 3 [pressed=true]",
          "button|Unread 1 [pressed=false]",
          "button|Alert Controls",
          "button|Mark All Read",
          "button|Close Message",
          "button|Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m",
          "button|Dismiss Tournament",
          "button|Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h",
          "button|Dismiss Settlement",
          "button|River Rat Sent You A Friend Request.2d (disabled)",
          "button|Dismiss Tournament",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.",
            "5m",
            "Week 47 Settled: 1,250.75 Chips Credited.",
            "3h",
            "2d",
          ],
          "hooks": [
            "data-notif-id=seat-call",
            "data-notif-id=settled",
            "data-notif-id=friend",
          ],
        },
        "regions": [
          "div|group|Filter Notifications|",
          "div|alert||",
          "h2||Today Notifications|",
          "article|||",
          "button||Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left.. 5m|",
          "span||Unread|",
          "button||Dismiss Tournament|",
          "article|||",
          "button||Settlement Week 47 Settled: 1,250.75 Chips Credited.. 3h|",
          "button||Dismiss Settlement|",
          "h2||This Week Notifications|",
          "article|||",
          "button||Dismiss Tournament|",
        ],
        "text": "All 3 Unread 1 Alert Controls Mark All Read Dismissal Could Not Be Confirmed. Check The Signal And Try Again. Close Message Today Kings Club A Seat Opened At 1/2 No Limit Hold Em. Table 4 Has 2 Seats Left. 5m Settlement Week 47 Settled: 1,250.75 Chips Credited. 3h This Week River Rat Sent You A Friend Request. 2d",
      }
    `);
  });
});
