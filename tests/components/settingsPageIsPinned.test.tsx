/**
 * THE SETTINGS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign player pages batch P5, 2026-11-28)
 *
 * The Control Room is moving from its #SmarterCasinoRealism dress to the arena
 * workspace. The condition: no figure, word, data hook, named region or
 * control (with its pressed, checked and disabled state) may change, and every
 * toggle keeps its behaviour and its label. This renders the real page with
 * synthetic reads and pins all of it (tests/helpers/surfacePin.ts) in each
 * state the page shows: loading (the email not read yet), ready, ready with
 * push on and two-factor on, a toggle changed (the preference saved and the
 * switch flipped) and the account sync failed. The page head is the one part
 * the pass replaces; surfacePin leaves out its title and "?". The snapshots
 * were recorded against the old page on main 65a64d1f6 and are unchanged by
 * the pass.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  persistAccountSettings: vi.fn(),
  writeSettingsPageCache: vi.fn(() => true),
  updateTableSettings: vi.fn(),
  email: 'owner@kings.club' as string | null,
  pushSubscribed: false,
  totp: [] as Array<{ id: string; status: string }>,
  tableSettings: {
    isSoundEnabled: true,
    soundVolume: 70,
    animationSpeed: 1,
    cardBack: 'classic_blue',
    fourColorDeck: false,
    showPotOdds: false,
    showTicker: true,
    confirmAllIn: true,
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  settingsStoreState: {
    interfaceThemeScopeReady: true,
    interfaceThemeUserId: 'account-a' as string | null,
    themePreference: 'dark' as 'dark' | 'light' | 'auto',
    bindInterfaceThemeScope: vi.fn(),
    setTheme: vi.fn(),
  },
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'account-a' } }),
}));
vi.mock('../../src/lib/authUtils', () => ({
  readLocalSession: () => ({ userId: 'account-a' }),
}));
vi.mock('../../src/hooks/useTableSettings', () => ({
  useTableSettings: () => ({
    settings: mocks.tableSettings,
    updateSettings: mocks.updateTableSettings,
  }),
}));
vi.mock('../../src/stores/useSettingsStore', () => ({
  effectiveInterfaceTheme: (theme: string) => (theme === 'auto' ? 'dark' : theme),
  useSettingsStore: { getState: () => mocks.settingsStoreState },
}));
vi.mock('../../src/lib/persistAccountSettings', () => ({
  persistAccountSettings: mocks.persistAccountSettings,
}));
vi.mock('../../src/lib/settingsPageCache', () => ({
  readSettingsPageCache: vi.fn(() => null),
  removeSettingsPageCache: vi.fn(),
  retireLegacyGlobalSettingsPageCache: vi.fn(),
  writeSettingsPageCache: mocks.writeSettingsPageCache,
}));
vi.mock('../../src/lib/supabase', () => {
  const from = (table: string) => {
    let selected = '';
    const builder: Record<string, any> = {};
    builder.select = (columns: string) => {
      selected = columns;
      return builder;
    };
    builder.eq = () => builder;
    builder.maybeSingle = () => {
      if (table === 'profiles' && selected.includes('is_vip')) {
        return Promise.resolve({ data: { is_vip: false, tier: null }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.upsert = () => Promise.resolve({ data: null, error: null });
    return builder;
  };
  const user = () => (mocks.email ? { id: 'account-a', email: mocks.email } : null);
  return {
    getAuthUser: () =>
      mocks.email ? Promise.resolve({ data: { user: user() } }) : new Promise(() => {}),
    supabase: {
      from,
      auth: {
        getSession: () =>
          mocks.email
            ? Promise.resolve({ data: { session: { user: user() } }, error: null })
            : new Promise(() => {}),
        getUser: () =>
          mocks.email
            ? Promise.resolve({ data: { user: user() }, error: null })
            : new Promise(() => {}),
        mfa: {
          listFactors: () => Promise.resolve({ data: { totp: mocks.totp }, error: null }),
        },
      },
    },
  };
});
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribeDebounced: () => () => {} },
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/lib/pushClient', () => ({
  disablePush: vi.fn(),
  enablePush: vi.fn(),
  hasLocalSubscription: () => Promise.resolve(mocks.pushSubscribed),
  isIos: () => false,
  isIosStandalonePwa: () => false,
  isWebPushSupported: () => true,
  notificationPermission: () => 'default',
  sendTestPush: vi.fn(),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/layouts/StandardContentLayout', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <main data-testid="settings-root" className={className}>
      {children}
    </main>
  ),
}));
vi.mock('../../src/components/common/ConfirmModal', () => ({ default: () => null }));
vi.mock('../../src/components/table/ThemeSettingsModal', () => ({
  ThemeSettingsModal: () => null,
}));

import SettingsPage from '../../src/pages/SettingsPage';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function mount() {
  const view = render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>
  );
  await flush();
  return view;
}

function pin() {
  return surfacePin(screen.getByTestId('settings-root'));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.email = 'owner@kings.club';
  mocks.pushSubscribed = false;
  mocks.totp = [];
  mocks.persistAccountSettings.mockResolvedValue({ ok: true });
  mocks.settingsStoreState.themePreference = 'dark';
});

afterEach(() => cleanup());

describe('the Settings page prints the same surface after its frames move', () => {
  it('loading: the email not read yet', async () => {
    mocks.email = null;
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Account Data|",
          "button|button|Action Controller|aria-selected=true",
          "button|button|Alerts|",
          "button|button|Apply Postflop Pot Percentages|",
          "button|button|Apply Preflop Multipliers|",
          "button|button|Audio|",
          "button|button|Change Default Button Amounts|aria-selected=false",
          "button|button|Open Studio|",
          "button|button|Raise 9Arena Blue|aria-pressed=true",
          "button|button|Raise 9Black Platinum|aria-pressed=false",
          "button|button|Raise 9Casino Emerald|aria-pressed=false",
          "button|button|Raise 9Champagne Gold|aria-pressed=false",
          "button|button|Raise 9Deep Teal|aria-pressed=false",
          "button|button|Raise 9Midnight Navy|aria-pressed=false",
          "button|button|Restore Defaults|",
          "button|button|Restore Defaults|",
          "button|button|Security|",
          "button|button|Sign Out|",
          "button|button|Table & Display|",
          "button||Change|",
          "button||Change|",
          "button||Close Account|",
          "button||Enable|",
          "button||Enable|",
          "button||Export|",
          "button||Reset|",
          "input|checkbox|Achievement Unlocked|checked,value=on",
          "input|checkbox|Announcement Ticker|checked,value=on",
          "input|checkbox|Club Activity|checked,value=on",
          "input|checkbox|Four-Color Deck|unchecked,value=on",
          "input|checkbox|Friend Alerts|checked,value=on",
          "input|checkbox|Settlement Alerts|checked,value=on",
          "input|checkbox|Show Pot Odds|unchecked,value=on",
          "input|checkbox|Sound Effects|checked,value=on",
          "input|checkbox|Tournament Reminders|checked,value=on",
          "input|range|Sound Volume|value=70",
          "input|text|Postflop Pot Percentages Option 1|value=33",
          "input|text|Postflop Pot Percentages Option 2|value=50",
          "input|text|Postflop Pot Percentages Option 3|value=75",
          "input|text|Postflop Pot Percentages Option 4|value=100",
          "input|text|Preflop Multipliers Option 1|value=2.5",
          "input|text|Preflop Multipliers Option 2|value=3",
          "input|text|Preflop Multipliers Option 3|value=3.5",
          "input|text|Preflop Multipliers Option 4|value=4",
          "select||Animation Speed|value=",
          "select||Theme|value=",
        ],
        "money": {
          "figures": [
            "70",
            "1",
            "2",
            "3",
            "4",
            "1",
            "2",
            "3",
            "4",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
          ],
          "hooks": [
            "data-tone=default",
            "data-controller-color=blue",
            "data-controller-color=green",
            "data-controller-color=navy",
            "data-controller-color=platinum",
            "data-controller-color=gold",
            "data-controller-color=teal",
          ],
        },
        "regions": [
          "span|status|",
          "nav||Settings Sections",
          "input||Sound Effects",
          "input||Sound Volume",
          "section||Action Controller",
          "div|tablist|Action Controller Settings",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "input||Preflop Multipliers Option 1",
          "input||Preflop Multipliers Option 2",
          "input||Preflop Multipliers Option 3",
          "input||Preflop Multipliers Option 4",
          "input||Postflop Pot Percentages Option 1",
          "input||Postflop Pot Percentages Option 2",
          "input||Postflop Pot Percentages Option 3",
          "input||Postflop Pot Percentages Option 4",
          "div|tabpanel|",
          "div||Action Controller Colors",
          "select||Theme",
          "input||Four-Color Deck",
          "input||Announcement Ticker",
          "select||Animation Speed",
          "input||Show Pot Odds",
          "input||Tournament Reminders",
          "input||Club Activity",
          "input||Achievement Unlocked",
          "input||Friend Alerts",
          "input||Settlement Alerts",
        ],
        "text": "Systems Synced | All Visible Controls Are Saved. | Audio | Sound Effects | Play Sounds For Actions And Events | Sound Volume | 70 | % | Table & Display | Preflop Multipliers | Option | 1 | ( | X | ) | Option | 2 | ( | X | ) | Option | 3 | ( | X | ) | Option | 4 | ( | X | ) | Postflop Pot Percentages | Option | 1 | ( | % | ) | Option | 2 | ( | % | ) | Option | 3 | ( | % | ) | Option | 4 | ( | % | ) | Preflop Uses The Bet You Face, Or The Big Blind. Postflop Uses The Pot After Calling. Legal Minimums, Stack And Pot-Limit Caps Still Apply. | Applies To All Your Tables. Tap Outside The Open Controller To Close It. | Theme | Dark | Light | Auto (System) | Appearance Suite | Table Studio | Tables, Backgrounds, Buttons And Card Backs In One Live Studio | Four-Color Deck | Hearts ♥, Diamonds ♦ (Blue), Clubs ♣ (Green), Spades ♠ | Announcement Ticker | Show The Scrolling Tournament And Announcement Ticker | Animation Speed | Slow | Normal | Fast | Show Pot Odds | Display Pot Odds During Your Action | Notifications | Tournament Reminders | Notify Before Registered Tournaments Start | Club Activity | New Tables, Tournaments, And Announcements | Achievement Unlocked | Friend Alerts | Friend Requests, Status Changes | Settlement Alerts | Chip Settlement And Transfer Notifications | Push Notifications | Get Alerted The Moment Your Seat Opens | Identity Security | Email | Loading... | Password | Two-Factor Authentication | Add Extra Security To Your Account | Sign Out | End This Session On This Device | Account Data & Closure | Export Data | Download All Your Data And Hand Histories | Close Account | Permanently Delete Your Account. Settle Every Club Balance First",
      }
    `);
  });

  it('ready', async () => {
    await mount();
    expect(screen.getByRole('checkbox', { name: 'Sound Effects' })).toBeChecked();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Account Data|",
          "button|button|Action Controller|aria-selected=true",
          "button|button|Alerts|",
          "button|button|Apply Postflop Pot Percentages|",
          "button|button|Apply Preflop Multipliers|",
          "button|button|Audio|",
          "button|button|Change Default Button Amounts|aria-selected=false",
          "button|button|Open Studio|",
          "button|button|Raise 9Arena Blue|aria-pressed=true",
          "button|button|Raise 9Black Platinum|aria-pressed=false",
          "button|button|Raise 9Casino Emerald|aria-pressed=false",
          "button|button|Raise 9Champagne Gold|aria-pressed=false",
          "button|button|Raise 9Deep Teal|aria-pressed=false",
          "button|button|Raise 9Midnight Navy|aria-pressed=false",
          "button|button|Restore Defaults|",
          "button|button|Restore Defaults|",
          "button|button|Security|",
          "button|button|Sign Out|",
          "button|button|Table & Display|",
          "button||Change|",
          "button||Change|",
          "button||Close Account|",
          "button||Enable|",
          "button||Enable|",
          "button||Export|",
          "button||Reset|",
          "input|checkbox|Achievement Unlocked|checked,value=on",
          "input|checkbox|Announcement Ticker|checked,value=on",
          "input|checkbox|Club Activity|checked,value=on",
          "input|checkbox|Four-Color Deck|unchecked,value=on",
          "input|checkbox|Friend Alerts|checked,value=on",
          "input|checkbox|Settlement Alerts|checked,value=on",
          "input|checkbox|Show Pot Odds|unchecked,value=on",
          "input|checkbox|Sound Effects|checked,value=on",
          "input|checkbox|Tournament Reminders|checked,value=on",
          "input|range|Sound Volume|value=70",
          "input|text|Postflop Pot Percentages Option 1|value=33",
          "input|text|Postflop Pot Percentages Option 2|value=50",
          "input|text|Postflop Pot Percentages Option 3|value=75",
          "input|text|Postflop Pot Percentages Option 4|value=100",
          "input|text|Preflop Multipliers Option 1|value=2.5",
          "input|text|Preflop Multipliers Option 2|value=3",
          "input|text|Preflop Multipliers Option 3|value=3.5",
          "input|text|Preflop Multipliers Option 4|value=4",
          "select||Animation Speed|value=",
          "select||Theme|value=",
        ],
        "money": {
          "figures": [
            "70",
            "1",
            "2",
            "3",
            "4",
            "1",
            "2",
            "3",
            "4",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
          ],
          "hooks": [
            "data-tone=default",
            "data-controller-color=blue",
            "data-controller-color=green",
            "data-controller-color=navy",
            "data-controller-color=platinum",
            "data-controller-color=gold",
            "data-controller-color=teal",
          ],
        },
        "regions": [
          "span|status|",
          "nav||Settings Sections",
          "input||Sound Effects",
          "input||Sound Volume",
          "section||Action Controller",
          "div|tablist|Action Controller Settings",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "input||Preflop Multipliers Option 1",
          "input||Preflop Multipliers Option 2",
          "input||Preflop Multipliers Option 3",
          "input||Preflop Multipliers Option 4",
          "input||Postflop Pot Percentages Option 1",
          "input||Postflop Pot Percentages Option 2",
          "input||Postflop Pot Percentages Option 3",
          "input||Postflop Pot Percentages Option 4",
          "div|tabpanel|",
          "div||Action Controller Colors",
          "select||Theme",
          "input||Four-Color Deck",
          "input||Announcement Ticker",
          "select||Animation Speed",
          "input||Show Pot Odds",
          "input||Tournament Reminders",
          "input||Club Activity",
          "input||Achievement Unlocked",
          "input||Friend Alerts",
          "input||Settlement Alerts",
        ],
        "text": "Systems Synced | All Visible Controls Are Saved. | Audio | Sound Effects | Play Sounds For Actions And Events | Sound Volume | 70 | % | Table & Display | Preflop Multipliers | Option | 1 | ( | X | ) | Option | 2 | ( | X | ) | Option | 3 | ( | X | ) | Option | 4 | ( | X | ) | Postflop Pot Percentages | Option | 1 | ( | % | ) | Option | 2 | ( | % | ) | Option | 3 | ( | % | ) | Option | 4 | ( | % | ) | Preflop Uses The Bet You Face, Or The Big Blind. Postflop Uses The Pot After Calling. Legal Minimums, Stack And Pot-Limit Caps Still Apply. | Applies To All Your Tables. Tap Outside The Open Controller To Close It. | Theme | Dark | Light | Auto (System) | Appearance Suite | Table Studio | Tables, Backgrounds, Buttons And Card Backs In One Live Studio | Four-Color Deck | Hearts ♥, Diamonds ♦ (Blue), Clubs ♣ (Green), Spades ♠ | Announcement Ticker | Show The Scrolling Tournament And Announcement Ticker | Animation Speed | Slow | Normal | Fast | Show Pot Odds | Display Pot Odds During Your Action | Notifications | Tournament Reminders | Notify Before Registered Tournaments Start | Club Activity | New Tables, Tournaments, And Announcements | Achievement Unlocked | Friend Alerts | Friend Requests, Status Changes | Settlement Alerts | Chip Settlement And Transfer Notifications | Push Notifications | Get Alerted The Moment Your Seat Opens | Identity Security | Email | owner@kings.club | Password | Two-Factor Authentication | Add Extra Security To Your Account | Sign Out | End This Session On This Device | Account Data & Closure | Export Data | Download All Your Data And Hand Histories | Close Account | Permanently Delete Your Account. Settle Every Club Balance First",
      }
    `);
  });

  it('ready with push and two-factor on', async () => {
    mocks.pushSubscribed = true;
    mocks.totp = [{ id: 'factor-1', status: 'verified' }];
    await mount();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Account Data|",
          "button|button|Action Controller|aria-selected=true",
          "button|button|Alerts|",
          "button|button|Apply Postflop Pot Percentages|",
          "button|button|Apply Preflop Multipliers|",
          "button|button|Audio|",
          "button|button|Change Default Button Amounts|aria-selected=false",
          "button|button|Open Studio|",
          "button|button|Raise 9Arena Blue|aria-pressed=true",
          "button|button|Raise 9Black Platinum|aria-pressed=false",
          "button|button|Raise 9Casino Emerald|aria-pressed=false",
          "button|button|Raise 9Champagne Gold|aria-pressed=false",
          "button|button|Raise 9Deep Teal|aria-pressed=false",
          "button|button|Raise 9Midnight Navy|aria-pressed=false",
          "button|button|Restore Defaults|",
          "button|button|Restore Defaults|",
          "button|button|Security|",
          "button|button|Sign Out|",
          "button|button|Table & Display|",
          "button||Change|",
          "button||Change|",
          "button||Close Account|",
          "button||Disable|",
          "button||Export|",
          "button||Reset|",
          "button||Send Test|",
          "button||Turn Off|",
          "input|checkbox|Achievement Unlocked|checked,value=on",
          "input|checkbox|Announcement Ticker|checked,value=on",
          "input|checkbox|Club Activity|checked,value=on",
          "input|checkbox|Four-Color Deck|unchecked,value=on",
          "input|checkbox|Friend Alerts|checked,value=on",
          "input|checkbox|Settlement Alerts|checked,value=on",
          "input|checkbox|Show Pot Odds|unchecked,value=on",
          "input|checkbox|Sound Effects|checked,value=on",
          "input|checkbox|Tournament Reminders|checked,value=on",
          "input|range|Sound Volume|value=70",
          "input|text|Postflop Pot Percentages Option 1|value=33",
          "input|text|Postflop Pot Percentages Option 2|value=50",
          "input|text|Postflop Pot Percentages Option 3|value=75",
          "input|text|Postflop Pot Percentages Option 4|value=100",
          "input|text|Preflop Multipliers Option 1|value=2.5",
          "input|text|Preflop Multipliers Option 2|value=3",
          "input|text|Preflop Multipliers Option 3|value=3.5",
          "input|text|Preflop Multipliers Option 4|value=4",
          "select||Animation Speed|value=",
          "select||Theme|value=",
        ],
        "money": {
          "figures": [
            "70",
            "1",
            "2",
            "3",
            "4",
            "1",
            "2",
            "3",
            "4",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
          ],
          "hooks": [
            "data-tone=default",
            "data-controller-color=blue",
            "data-controller-color=green",
            "data-controller-color=navy",
            "data-controller-color=platinum",
            "data-controller-color=gold",
            "data-controller-color=teal",
          ],
        },
        "regions": [
          "span|status|",
          "nav||Settings Sections",
          "input||Sound Effects",
          "input||Sound Volume",
          "section||Action Controller",
          "div|tablist|Action Controller Settings",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "input||Preflop Multipliers Option 1",
          "input||Preflop Multipliers Option 2",
          "input||Preflop Multipliers Option 3",
          "input||Preflop Multipliers Option 4",
          "input||Postflop Pot Percentages Option 1",
          "input||Postflop Pot Percentages Option 2",
          "input||Postflop Pot Percentages Option 3",
          "input||Postflop Pot Percentages Option 4",
          "div|tabpanel|",
          "div||Action Controller Colors",
          "select||Theme",
          "input||Four-Color Deck",
          "input||Announcement Ticker",
          "select||Animation Speed",
          "input||Show Pot Odds",
          "input||Tournament Reminders",
          "input||Club Activity",
          "input||Achievement Unlocked",
          "input||Friend Alerts",
          "input||Settlement Alerts",
        ],
        "text": "Systems Synced | All Visible Controls Are Saved. | Audio | Sound Effects | Play Sounds For Actions And Events | Sound Volume | 70 | % | Table & Display | Preflop Multipliers | Option | 1 | ( | X | ) | Option | 2 | ( | X | ) | Option | 3 | ( | X | ) | Option | 4 | ( | X | ) | Postflop Pot Percentages | Option | 1 | ( | % | ) | Option | 2 | ( | % | ) | Option | 3 | ( | % | ) | Option | 4 | ( | % | ) | Preflop Uses The Bet You Face, Or The Big Blind. Postflop Uses The Pot After Calling. Legal Minimums, Stack And Pot-Limit Caps Still Apply. | Applies To All Your Tables. Tap Outside The Open Controller To Close It. | Theme | Dark | Light | Auto (System) | Appearance Suite | Table Studio | Tables, Backgrounds, Buttons And Card Backs In One Live Studio | Four-Color Deck | Hearts ♥, Diamonds ♦ (Blue), Clubs ♣ (Green), Spades ♠ | Announcement Ticker | Show The Scrolling Tournament And Announcement Ticker | Animation Speed | Slow | Normal | Fast | Show Pot Odds | Display Pot Odds During Your Action | Notifications | Tournament Reminders | Notify Before Registered Tournaments Start | Club Activity | New Tables, Tournaments, And Announcements | Achievement Unlocked | Friend Alerts | Friend Requests, Status Changes | Settlement Alerts | Chip Settlement And Transfer Notifications | Push Notifications | On For This Device | Send A Test Notification | Check That Alerts Actually Reach This Device | Identity Security | Email | owner@kings.club | Password | Two-Factor Authentication | Enabled - Your Account Is Protected | Sign Out | End This Session On This Device | Account Data & Closure | Export Data | Download All Your Data And Hand Histories | Close Account | Permanently Delete Your Account. Settle Every Club Balance First",
      }
    `);
  });

  it('a toggle flips and keeps its label', async () => {
    await mount();
    const toggle = screen.getByRole('checkbox', { name: 'Friend Alerts' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await flush();
    expect(screen.getByRole('checkbox', { name: 'Friend Alerts' })).not.toBeChecked();
    expect(pin().controls.filter((c) => c.includes('Friend Alerts'))).toMatchInlineSnapshot(`
      [
        "input|checkbox|Friend Alerts|checked,value=on",
      ]
    `);
  });

  it('the account sync failed', async () => {
    mocks.persistAccountSettings.mockRejectedValue(new Error('offline'));
    await mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Pot Odds' }));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 700));
    });
    await flush();
    expect(screen.getByRole('button', { name: 'Retry Account Sync' })).not.toBeNull();
    expect(pin()).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Account Data|",
          "button|button|Action Controller|aria-selected=true",
          "button|button|Alerts|",
          "button|button|Apply Postflop Pot Percentages|",
          "button|button|Apply Preflop Multipliers|",
          "button|button|Audio|",
          "button|button|Change Default Button Amounts|aria-selected=false",
          "button|button|Open Studio|",
          "button|button|Raise 9Arena Blue|aria-pressed=true",
          "button|button|Raise 9Black Platinum|aria-pressed=false",
          "button|button|Raise 9Casino Emerald|aria-pressed=false",
          "button|button|Raise 9Champagne Gold|aria-pressed=false",
          "button|button|Raise 9Deep Teal|aria-pressed=false",
          "button|button|Raise 9Midnight Navy|aria-pressed=false",
          "button|button|Restore Defaults|",
          "button|button|Restore Defaults|",
          "button|button|Security|",
          "button|button|Sign Out|",
          "button|button|Table & Display|",
          "button||Change|",
          "button||Change|",
          "button||Close Account|",
          "button||Enable|",
          "button||Enable|",
          "button||Export|",
          "button||Reset|",
          "button||Retry Account Sync|",
          "input|checkbox|Achievement Unlocked|checked,value=on",
          "input|checkbox|Announcement Ticker|checked,value=on",
          "input|checkbox|Club Activity|checked,value=on",
          "input|checkbox|Four-Color Deck|unchecked,value=on",
          "input|checkbox|Friend Alerts|checked,value=on",
          "input|checkbox|Settlement Alerts|checked,value=on",
          "input|checkbox|Show Pot Odds|unchecked,value=on",
          "input|checkbox|Sound Effects|checked,value=on",
          "input|checkbox|Tournament Reminders|checked,value=on",
          "input|range|Sound Volume|value=70",
          "input|text|Postflop Pot Percentages Option 1|value=33",
          "input|text|Postflop Pot Percentages Option 2|value=50",
          "input|text|Postflop Pot Percentages Option 3|value=75",
          "input|text|Postflop Pot Percentages Option 4|value=100",
          "input|text|Preflop Multipliers Option 1|value=2.5",
          "input|text|Preflop Multipliers Option 2|value=3",
          "input|text|Preflop Multipliers Option 3|value=3.5",
          "input|text|Preflop Multipliers Option 4|value=4",
          "select||Animation Speed|value=",
          "select||Theme|value=",
        ],
        "money": {
          "figures": [
            "70",
            "1",
            "2",
            "3",
            "4",
            "1",
            "2",
            "3",
            "4",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
            "Raise 9",
          ],
          "hooks": [
            "data-tone=default",
            "data-controller-color=blue",
            "data-controller-color=green",
            "data-controller-color=navy",
            "data-controller-color=platinum",
            "data-controller-color=gold",
            "data-controller-color=teal",
          ],
        },
        "regions": [
          "span|status|",
          "nav||Settings Sections",
          "input||Sound Effects",
          "input||Sound Volume",
          "section||Action Controller",
          "div|tablist|Action Controller Settings",
          "button|tab|",
          "button|tab|",
          "div|tabpanel|",
          "input||Preflop Multipliers Option 1",
          "input||Preflop Multipliers Option 2",
          "input||Preflop Multipliers Option 3",
          "input||Preflop Multipliers Option 4",
          "input||Postflop Pot Percentages Option 1",
          "input||Postflop Pot Percentages Option 2",
          "input||Postflop Pot Percentages Option 3",
          "input||Postflop Pot Percentages Option 4",
          "div|tabpanel|",
          "div||Action Controller Colors",
          "select||Theme",
          "input||Four-Color Deck",
          "input||Announcement Ticker",
          "select||Animation Speed",
          "input||Show Pot Odds",
          "input||Tournament Reminders",
          "input||Club Activity",
          "input||Achievement Unlocked",
          "input||Friend Alerts",
          "input||Settlement Alerts",
        ],
        "text": "Changes Pending | Choices Are Saved On This Device. Account Sync Is Pending. | Audio | Sound Effects | Play Sounds For Actions And Events | Sound Volume | 70 | % | Table & Display | Preflop Multipliers | Option | 1 | ( | X | ) | Option | 2 | ( | X | ) | Option | 3 | ( | X | ) | Option | 4 | ( | X | ) | Postflop Pot Percentages | Option | 1 | ( | % | ) | Option | 2 | ( | % | ) | Option | 3 | ( | % | ) | Option | 4 | ( | % | ) | Preflop Uses The Bet You Face, Or The Big Blind. Postflop Uses The Pot After Calling. Legal Minimums, Stack And Pot-Limit Caps Still Apply. | Applies To All Your Tables. Tap Outside The Open Controller To Close It. | Theme | Dark | Light | Auto (System) | Appearance Suite | Table Studio | Tables, Backgrounds, Buttons And Card Backs In One Live Studio | Four-Color Deck | Hearts ♥, Diamonds ♦ (Blue), Clubs ♣ (Green), Spades ♠ | Announcement Ticker | Show The Scrolling Tournament And Announcement Ticker | Animation Speed | Slow | Normal | Fast | Show Pot Odds | Display Pot Odds During Your Action | Notifications | Tournament Reminders | Notify Before Registered Tournaments Start | Club Activity | New Tables, Tournaments, And Announcements | Achievement Unlocked | Friend Alerts | Friend Requests, Status Changes | Settlement Alerts | Chip Settlement And Transfer Notifications | Push Notifications | Get Alerted The Moment Your Seat Opens | Identity Security | Email | owner@kings.club | Password | Two-Factor Authentication | Add Extra Security To Your Account | Sign Out | End This Session On This Device | Account Data & Closure | Export Data | Download All Your Data And Hand Histories | Close Account | Permanently Delete Your Account. Settle Every Club Balance First",
      }
    `);
  });
});
