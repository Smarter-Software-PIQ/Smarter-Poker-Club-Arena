/**
 * THE FRIENDS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P5, 2026-11-28)
 *
 * Connections is moving from its Relationship Command dress to the arena
 * workspace. The condition: no figure, word, data hook, named region or
 * control (with its selected and disabled state) may change. This renders the
 * real page with synthetic reads and pins all of it
 * (tests/helpers/surfacePin.ts) in each state the page shows: loading, failed,
 * empty, ready (online and offline friends, a profile that needs repair, a
 * pending request) on the Friends and Requests tabs, and the filter matching
 * nothing. The page head is the one part the pass replaces; surfacePin leaves
 * out its title and "?". The snapshots were recorded against the old page on
 * main 65a64d1f6 and are unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  fail: false,
  hang: false,
  profiles: [] as unknown[],
  online: new Set<string>(),
  toast: { success: () => {}, error: () => {}, info: () => {} },
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'fixture-account' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => mocks.toast,
}));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: () => {} }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/hooks/useProfilePresence', () => ({ useProfilePresence: () => new Map() }));
vi.mock('../../src/utils/fetchAllRows', () => ({
  fetchAllRows: (_query: unknown, options: { label: string }) => {
    if (mocks.hang) return new Promise(() => {});
    if (mocks.fail) return Promise.reject(new Error('Could Not Reach Your Connections'));
    return Promise.resolve(mocks.rows[options.label] ?? []);
  },
}));
vi.mock('../../src/utils/retryFetch', () => ({
  retryFetch: async (read: () => unknown) => read(),
}));
vi.mock('../../src/lib/ownProfile', () => ({
  readPresence: async (ids: string[]) => new Map(ids.map((id) => [id, mocks.online.has(id)])),
}));
vi.mock('../../src/lib/supabase', () => {
  const builder: Record<string, any> = {};
  for (const name of ['select', 'eq', 'order', 'range']) builder[name] = () => builder;
  builder.in = () => Promise.resolve({ data: mocks.profiles, error: null });
  return { supabase: { from: () => builder, rpc: () => Promise.resolve({ data: null }) } };
});
vi.mock('../../src/components/social/FriendActivityFeed', () => ({ default: () => null }));
vi.mock('../../src/components/social/FriendChallengeModal', () => ({ default: () => null }));
vi.mock('../../src/components/social/FriendChallengesPanel', () => ({ default: () => null }));
vi.mock('../../src/components/social/FriendSuggestions', () => ({ default: () => null }));

import FriendsPage from '../../src/pages/FriendsPage';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function mount(entry = '/friends') {
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <FriendsPage />
    </MemoryRouter>
  );
  await flush();
  return view;
}

function pin() {
  return surfacePin(document.querySelector('.friends-page') as HTMLElement);
}

const profile = (id: string, alias: string) => ({
  id,
  username: alias,
  alias,
  display_name: alias,
  display_name_preference: 'alias',
  use_real_name: false,
  avatar_url: null,
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mocks.rows = {};
  mocks.fail = false;
  mocks.hang = false;
  mocks.profiles = [];
  mocks.online = new Set();
});

afterEach(() => cleanup());

function ready() {
  mocks.rows = {
    'FriendsPage.accepted_sent': [
      { id: 'f-1', friend_id: 'p-river', status: 'accepted' },
      { id: 'f-2', friend_id: 'p-button', status: 'accepted' },
    ],
    'FriendsPage.accepted_received': [{ id: 'f-3', user_id: 'p-ghost', status: 'accepted' }],
    'FriendsPage.pending_received': [{ id: 'f-4', user_id: 'p-nuts' }],
  };
  mocks.profiles = [
    profile('p-river', 'RiverRat'),
    profile('p-button', 'ButtonMasher'),
    profile('p-nuts', 'NutPeddler'),
  ];
  mocks.online = new Set(['p-river']);
}

describe('the Friends page prints the same surface after its frames move', () => {
  it('loading', async () => {
    mocks.hang = true;
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Find Players|",
          "button|button|Friends0|aria-selected=true",
          "button|button|Open Messenger|",
          "button|button|Requests0|aria-selected=false",
          "input|search||value=",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=default",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|status|Loading Friends",
        ],
        "text": "Friends | 0 | Online | 0 | Requests | 0 | Relationship Command | Connections | Filter Your Friends",
      }
    `);
  });

  it('failed', async () => {
    mocks.fail = true;
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Find Players|",
          "button|button|Friends0|aria-selected=true",
          "button|button|Open Messenger|",
          "button|button|Requests0|aria-selected=false",
          "button|button|Try Again|",
          "input|search||value=",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=default",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|alert|",
        ],
        "text": "Friends | 0 | Online | 0 | Requests | 0 | Relationship Command | Connections | Filter Your Friends | ! | Your Connections Could Not Be Reached | Your Connections Are Safe. This Is A Problem Reaching Them, Not Losing Them.",
      }
    `);
  });

  it('empty, on the Friends and Requests tabs', async () => {
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Find Players|",
          "button|button|Find Players|",
          "button|button|Friends0|aria-selected=true",
          "button|button|Open Messenger|",
          "button|button|Requests0|aria-selected=false",
          "input|search||value=",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=default",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
        ],
        "text": "Friends | 0 | Online | 0 | Requests | 0 | Relationship Command | Connections | Filter Your Friends | ◇ | Build Your Poker Circle | Find Players You Trust, Then Message, Challenge, And Follow Their Activity Here.",
      }
    `);
    fireEvent.click(screen.getByRole('tab', { name: /^Requests/ }));
    await flush();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Discover Players|",
          "button|button|Find Players|",
          "button|button|Friends0|aria-selected=false",
          "button|button|Open Messenger|",
          "button|button|Requests0|aria-selected=true",
        ],
        "money": {
          "figures": [
            "0",
            "0",
            "0",
            "0",
            "0",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=default",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
        ],
        "text": "Friends | 0 | Online | 0 | Requests | 0 | Relationship Command | Connections | ⌁ | No Pending Requests | Incoming Connection Requests Will Appear Here With Clear Review Controls.",
      }
    `);
  });

  it('ready, on the Friends and Requests tabs', async () => {
    ready();
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|BButtonMasherOffline|",
          "button|button|Challenges|aria-selected=false",
          "button|button|Challenge|",
          "button|button|Challenge|",
          "button|button|Export CSV|",
          "button|button|Find Players|",
          "button|button|Friends3|aria-selected=true",
          "button|button|Message|",
          "button|button|Message|",
          "button|button|Open Messenger|",
          "button|button|PPlayer Profile UnavailableConnection Record Only|disabled",
          "button|button|RRiverRatOnline Now|",
          "button|button|Remove|",
          "button|button|Remove|",
          "button|button|Remove|",
          "button|button|Requests1|aria-selected=false",
          "input|search||value=",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "1",
            "3",
            "1",
            "1",
            "1",
            "2",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|status|",
          "i||Online",
          "div||Actions For RiverRat",
          "div||Actions For ButtonMasher",
          "div||Actions For Player Profile Unavailable",
        ],
        "text": "Friends | 3 | Online | 1 | Requests | 1 | Relationship Command | Connections | Filter Your Friends | 1 | Relationship Needs Profile Repair | These Records Remain Removable, But Profile, Message, And Challenge Actions Stay Disabled Until A Valid Player Profile Resolves. | Online Now | 1 | Offline | 2",
      }
    `);
    fireEvent.click(screen.getByRole('tab', { name: /^Requests/ }));
    await flush();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Accept|",
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Decline|",
          "button|button|Find Players|",
          "button|button|Friends3|aria-selected=false",
          "button|button|NNutPeddlerWants To Connect|",
          "button|button|Open Messenger|",
          "button|button|Requests1|aria-selected=true",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "1",
            "3",
            "1",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
        ],
        "text": "Friends | 3 | Online | 1 | Requests | 1 | Relationship Command | Connections",
      }
    `);
  });

  it('a filter that matches nothing', async () => {
    ready();
    await mount();
    fireEvent.change(screen.getByLabelText('Filter Your Friends'), {
      target: { value: 'Nobody' },
    });
    await flush();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Activity|aria-selected=false",
          "button|button|Challenges|aria-selected=false",
          "button|button|Find Players|",
          "button|button|Find Players|",
          "button|button|Friends3|aria-selected=true",
          "button|button|Open Messenger|",
          "button|button|Requests1|aria-selected=false",
          "input|search||value=Nobody",
        ],
        "money": {
          "figures": [
            "3",
            "1",
            "1",
            "3",
            "1",
            "1",
          ],
          "hooks": [
            "data-tone=default",
            "data-tone=live",
            "data-tone=attention",
          ],
        },
        "regions": [
          "dl||Your Poker Circle Live Summary",
          "div|tablist|Connection Views",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "div|status|",
        ],
        "text": "Friends | 3 | Online | 1 | Requests | 1 | Relationship Command | Connections | Filter Your Friends | 1 | Relationship Needs Profile Repair | These Records Remain Removable, But Profile, Message, And Challenge Actions Stay Disabled Until A Valid Player Profile Resolves. | ◇ | No Friends Match That Name | Clear The Filter Or Search The Wider Community.",
      }
    `);
  });
});
