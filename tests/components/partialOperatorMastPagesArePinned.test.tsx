/**
 * THE WELCOME MESSAGE, BANNER DISPLAYS AND TABLE BOMB SETTINGS PAGES ARE
 * PINNED BEFORE THEIR MAST IS ADDED (2026-11-28)
 *
 * Each page already prints in the chrome case; what it lacks is the chrome
 * mast. Adding it must not move a figure, a word, a data hook, a named region
 * or a control's state. Recorded against main f6ba3b40c before the mast went
 * on (tests/helpers/surfacePin.ts reads everything but the page head).
 */
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  welcome: vi.fn(),
  banner: vi.fn(),
  row: null as Record<string, unknown> | null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'owner' }, isHydrating: false }),
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUIDStrict: async () => 'club-uuid',
}));
vi.mock('../../src/services/ClubWelcomeMessageService', async (original) => ({
  ...(await original<typeof import('../../src/services/ClubWelcomeMessageService')>()),
  readClubWelcomeSettings: (...args: unknown[]) => mocks.welcome(...args),
  saveClubWelcomeSettings: vi.fn(),
}));
vi.mock('../../src/services/ClubBannerService', async (original) => ({
  ...(await original<typeof import('../../src/services/ClubBannerService')>()),
  readClubBanner: (...args: unknown[]) => mocks.banner(...args),
  saveClubBanner: vi.fn(),
  uploadClubBannerImage: vi.fn(),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            mocks.row ? { data: mocks.row, error: null } : { data: null, error: null },
        }),
      }),
    }),
  },
}));

import ClubWelcomeMessagePage from '../../src/pages/ClubWelcomeMessagePage';
import ClubBannerDisplaysPage from '../../src/pages/ClubBannerDisplaysPage';
import TableBombSettingsPage from '../../src/pages/club/TableBombSettingsPage';

function open(path: string, route: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>
  ).container;
}

const welcomeRow = {
  club_id: 'club-uuid',
  club_name: 'kings club',
  role: 'owner',
  content: 'Welcome To The Club! Message Me Here.',
  enabled: true,
  revision: 3,
  owner_content: '',
  owner_enabled: false,
  owner_revision: 0,
};

const bombRow = {
  name: 'NLH 1/2 Main',
  bomb_pot_enabled: true,
  bomb_pot_trigger_mode: 'every_n_hands',
  bomb_pot_frequency: 10,
  bomb_pot_interval_seconds: 1800,
  bomb_pot_board_count: 2,
  bomb_pot_min_players: 3,
  bomb_pot_ante_multiplier: 2,
  bomb_pot_ante_fixed: 0,
  bomb_pot_variant: null,
  bomb_pot_button_policy: 'regular',
  bomb_pot_announce_seconds: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = { ...bombRow };
  mocks.welcome.mockResolvedValue([welcomeRow]);
  mocks.banner.mockResolvedValue({
    id: 'club-uuid',
    name: 'kings club',
    owner_id: 'owner',
    banner_url: '/old.png',
    union_id: null,
  });
});
afterEach(cleanup);

describe('the welcome message page keeps every figure, word, region and control', () => {
  it('one club, ready to edit', async () => {
    const root = open(
      '/clubs/kings/welcome-message',
      '/clubs/:clubId/welcome-message',
      <ClubWelcomeMessagePage />
    );
    await screen.findByLabelText('Custom Message');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Reload|",
          "button|button|Save Message|",
          "input|checkbox||checked,value=on",
          "select||Message Purpose|value=",
          "textarea||Custom Message|value=Welcome To The Club! Message Me Here.",
        ],
        "money": {
          "figures": [
            "Club Welcome (10 Minutes)",
            "37",
            "/ 2,000 Characters",
          ],
          "hooks": [],
        },
        "regions": [
          "select||Message Purpose",
          "textarea||Custom Message",
        ],
        "text": "Kings Club | Custom Messages | Message Purpose | Downline Welcome | Club Welcome (10 Minutes) | Your Welcome Is Sent First When A Player Joins Your Downline. Without An Assigned Agent, The Club Owner Sends This First Welcome. | Automatically Send My Welcome Message | Custom Message | Welcome To The Club! Message Me Here. | 37 | / 2,000 Characters | Saving Applies To Future Joins And New Downline Assignments. Scheduled Welcomes Keep Their Original Text. Existing Members Are Not Sent A Bulk Message. Personal Blocks Are Respected.",
      }
    `);
  });
  it('no eligible club', async () => {
    mocks.welcome.mockResolvedValue([]);
    const root = open('/welcome-messages', '/welcome-messages', <ClubWelcomeMessagePage />);
    await screen.findByText('No Eligible Clubs. An Active Club Staff Role Is Required.');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Reload|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Custom Messages | No Eligible Clubs. An Active Club Staff Role Is Required.",
      }
    `);
  });
  it('load failure', async () => {
    mocks.welcome.mockRejectedValue(new Error('Welcome Messages Are Unavailable'));
    const root = open(
      '/clubs/kings/welcome-message',
      '/clubs/:clubId/welcome-message',
      <ClubWelcomeMessagePage />
    );
    await screen.findByRole('alert');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Reload|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|alert|",
        ],
        "text": "Custom Messages | Welcome Messages Are Unavailable",
      }
    `);
  });
});

describe('the banner displays page keeps every figure, word, region and control', () => {
  it('the owner with a banner set', async () => {
    const root = open(
      '/clubs/kings/banner-displays',
      '/clubs/:clubId/banner-displays',
      <ClubBannerDisplaysPage />
    );
    await screen.findByLabelText('Choose Banner Image');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Club|",
          "button|button|Reload|",
          "button|button|Remove Club Banner|",
          "button|button|Save Banner|disabled",
          "input|file||value=",
        ],
        "money": {
          "figures": [
            "JPEG, PNG, Or WebP. Maximum 2 MB. Use A Wide Image With Text Away From The Edges. Preview Shows The Full Image.",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Kings Club | Banner Displays | Club Banner Preview | Choose Banner Image | JPEG, PNG, Or WebP. Maximum 2 MB. Use A Wide Image With Text Away From The Edges. Preview Shows The Full Image. | Banner Taps Open Your Club Announcements. | Smarter.Poker Ads Are Managed By The Platform And Cannot Be Changed Or Turned Off By Clubs Or Unions.",
      }
    `);
  });
  it('a member who is not the owner', async () => {
    mocks.banner.mockResolvedValue({
      id: 'club-uuid',
      name: 'kings club',
      owner_id: 'someone-else',
      banner_url: null,
      union_id: null,
    });
    const root = open(
      '/clubs/kings/banner-displays',
      '/clubs/:clubId/banner-displays',
      <ClubBannerDisplaysPage />
    );
    await screen.findByText('Only The Club Owner Can Change Banner Displays.');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back To Club|",
          "button|button|Reload|",
          "button|button|Save Banner|disabled",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Kings Club | Banner Displays | Only The Club Owner Can Change Banner Displays.",
      }
    `);
  });
});

describe('the table bomb settings page keeps every figure, word, region and control', () => {
  it('a running table with bomb pots on', async () => {
    const root = open(
      '/clubs/c1/tables/t1/bomb-settings',
      '/clubs/:clubId/tables/:tableId/bomb-settings',
      <TableBombSettingsPage />
    );
    await screen.findByLabelText(/Bomb Pot Hand Interval/);
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
          "button|button|Bomb Pots OnlyEvery Hand Is A Bomb Pot|aria-pressed=false",
          "button|button|Every OrbitOne Bomb Each Time The Button Goes Round|aria-pressed=false",
          "button|button|Every Set Number Of HandsChoose Which Dealt Hand Becomes A Bomb Pot|aria-pressed=true",
          "button|button|On The ClockA Bomb Every Few Minutes|aria-pressed=false",
          "button|button|Save Settings|",
          "input|checkbox||checked,value=on",
          "input|checkbox||unchecked,value=on",
          "input|number||value=0",
          "input|number||value=2",
          "input|number||value=3",
          "input|text||value=10",
          "select||1 Board2 Boards3 Boards|value=",
          "select||Same As TableNLHPLO4PLO5PLO6|value=",
        ],
        "money": {
          "figures": [
            "NLH 1/2 Main",
            "Every 10th Hand Is A Bomb Pot",
            "1 Board",
            "2 Boards",
            "3 Boards",
            "Chips (0 = Use The Multiple)",
            "PLO4",
            "PLO5",
            "PLO6",
          ],
          "hooks": [
            "data-testid=bomb-interval-sentence",
          ],
        },
        "regions": [
          "div|group|Trigger",
        ],
        "text": "Bomb Pots | On | NLH 1/2 Main | Bomb Pots | Trigger | Bomb Pot Hand Interval | Hands | Every 10th Hand Is A Bomb Pot | Boards | 1 Board | 2 Boards | 3 Boards | Ante | X BB (Whole Blinds) | Or A Fixed Ante | Chips (0 = Use The Multiple) | Needs | Players Before It Fires | Played As | Same As Table | NLH | PLO4 | PLO5 | PLO6 | Separate Bomb Button",
      }
    `);
  });
  it('a table that cannot be read', async () => {
    mocks.row = null;
    const root = open(
      '/clubs/c1/tables/t1/bomb-settings',
      '/clubs/:clubId/tables/:tableId/bomb-settings',
      <TableBombSettingsPage />
    );
    await screen.findByRole('alert');
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Back|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "p|alert|",
        ],
        "text": "Bomb Pots | Error | Could Not Load This Table",
      }
    `);
  });
  it('loading', async () => {
    mocks.row = null;
    const root = open(
      '/clubs/c1/tables/t1/bomb-settings',
      '/clubs/:clubId/tables/:tableId/bomb-settings',
      <TableBombSettingsPage />
    );
    expect(surfacePin(root)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Bomb Pots | Loading | Loading Table Settings...",
      }
    `);
    await screen.findByRole('alert');
  });
});
