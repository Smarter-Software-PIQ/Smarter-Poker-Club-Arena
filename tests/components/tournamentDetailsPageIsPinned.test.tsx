/**
 * THE TOURNAMENT DETAILS PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch T1, 2026-11-28)
 *
 * The routed tournament page (/tournaments/:id, TournamentDetails) is moving
 * onto the arena workspace mast and its empty and error states onto chrome
 * cases. The condition on a money screen: no prize, buy-in or payout figure,
 * no word, data hook, named region or control may change, and Register and
 * Unregister keep their behaviour and their accessible names.
 *
 * This renders the real page with synthetic reads and pins every printed
 * figure (tests/helpers/moneyFigures.ts), the full printed text, every named
 * region and every control (with its selected, pressed and disabled state) in
 * each state the page shows: registering (open and registered), running (late
 * registration, seated, eliminated), finished, empty (not found and the club
 * join step), error and loading, on the route and in the in-game popup.
 *
 * The mast is the one part the pass adds, so the page is pinned with any
 * `.arena-workspace-mast` taken out (on the old page there is none). The
 * snapshots were recorded against the old page on main 9c60702dc and are
 * unchanged by the pass. The Overview tab is the real one; the other tabs are
 * their own surfaces and are not mounted by the default tab.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneyFigures } from '../helpers/moneyFigures';

const fixture = vi.hoisted(() => ({
  user: { id: 'viewer' } as { id: string } | null,
  register: vi.fn(),
  getTournament: vi.fn(),
  navigate: vi.fn(),
  queries: [] as { table: string; response: unknown }[],
}));

vi.mock('../../src/services/TournamentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/TournamentService')>();
  return {
    ...actual,
    tournamentService: {
      getTournament: fixture.getTournament,
      getCurrentLevelState: actual.tournamentService.getCurrentLevelState.bind(
        actual.tournamentService
      ),
    },
    tournamentUnregisterSuccessText: () => 'Unregistered',
  };
});
vi.mock('../../src/services/GameServerAPI', () => ({
  getServerStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/EngineStateClient', () => ({
  engineChannelClient: { onStatusChange: () => () => {} },
}));
vi.mock('../../src/services/RealtimeChannelService', () => ({
  realtimeChannelService: {
    subscribeToLobby: () => () => {},
    subscribeToTournament: () => () => {},
  },
}));
vi.mock('../../src/components/tournament/details/useSatellites', () => ({
  useSatellites: () => ({
    cards: [],
    registration: {},
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('../../src/components/tournament/RegistrationApprovalsPanel', () => ({
  default: () => null,
}));
vi.mock('../../src/components/tournament/TournamentDealReview', () => ({ default: () => null }));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: fixture.user }) }));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: fixture.register, isRegistering: false }),
  isLateStatus: (status: string) => ['RUNNING', 'LATE_REG'].includes(status),
}));
vi.mock('../../src/context/InTabLobbyContext', () => ({ useAppNavigate: () => fixture.navigate }));
vi.mock('../../src/hooks/useMysteryBounty', () => ({ useMysteryBounty: () => ({}) }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    getOrCreateChannel: () => {
      const channel: Record<string, unknown> = {};
      channel.on = () => channel;
      channel.subscribe = () => channel;
      return channel;
    },
    removeRegisteredChannel: vi.fn(),
    subscribe: () => () => {},
    subscribeDebounced: () => () => {},
  },
}));
vi.mock('../../src/hooks/usePlatformCapability', () => ({
  usePlatformCapability: () => 'unavailable',
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      const at = fixture.queries.findIndex((q) => q.table === table);
      const response = at >= 0 ? fixture.queries[at].response : { data: [], error: null };
      const chain: Record<string, unknown> = {
        then: (yes: (v: unknown) => unknown, no: (e: unknown) => unknown) =>
          Promise.resolve(response).then(yes, no),
      };
      for (const method of [
        'select',
        'abortSignal',
        'eq',
        'order',
        'not',
        'in',
        'range',
        'limit',
        'gt',
        'maybeSingle',
      ])
        chain[method] = () => chain;
      return chain;
    },
  },
}));
vi.mock('../../src/components/tournament/FinalTableOverlay', () => ({
  FinalTableOverlay: () => null,
}));
vi.mock('../../src/components/tournament/MysteryBountyCelebration', () => ({
  default: () => null,
}));

import { __resetServerClock } from '../../src/utils/serverClock';
import TournamentDetails from '../../src/pages/tournament/TournamentDetails';

const NOW = Date.parse('2026-11-28T18:00:00Z');
const ID = 'a1b2c3d4-0000-4000-8000-000000000001';

const tournament = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Sunday Major',
  status: 'REGISTERING',
  format_contract: 'mtt-v1',
  game_type: 'nlh',
  starting_chips: 20000,
  buy_in_amount: 100,
  buy_in_fee: 10,
  guaranteed_prize: 5000,
  prize_pool: 1200,
  current_level: 1,
  current_players: 12,
  max_players: 180,
  min_players: 2,
  late_reg_levels: 6,
  start_time: new Date(NOW + 45 * 60_000).toISOString(),
  blind_structure: [
    { level: 1, small_blind: 100, big_blind: 200, ante: 0, duration: 10 },
    { level: 2, small_blind: 150, big_blind: 300, ante: 0, duration: 10 },
  ],
  payout_structure: [],
  short_description: 'Deep Stack Sunday Event',
  ...extra,
});

const entry = (extra: Record<string, unknown> = {}) => ({
  id: 'entry-viewer',
  user_id: 'viewer',
  username: 'Viewer',
  status: 'registered',
  chips: 20000,
  table_id: null,
  ...extra,
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
};

function rows(table: string, response: unknown) {
  fixture.queries.push({ table, response });
}

async function show({ search = '', onClose }: { search?: string; onClose?: () => void } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[`/tournaments/${ID}${search}`]}>
      <Routes>
        <Route
          path="/tournaments/:tournamentId"
          element={
            onClose ? (
              <TournamentDetails
                tournamentIdOverride={ID}
                suppressAutoOpenTable
                onClose={onClose}
                currentTableId="table-host"
              />
            ) : (
              <TournamentDetails suppressAutoOpenTable />
            )
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  return view;
}

const DATE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?/g;
function normalize(text: string): string {
  return (
    text
      .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, '<date>')
      .replace(DATE, '<date>')
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/gi, '<time>')
      // The zone the runner sits in (CST here, UTC on CI) is not a frame either.
      .replace(/<time> (?:[A-Z]{2,5}|GMT)(?:[+-]\d{1,2}(?::\d{2})?)?\b/g, '<time> <zone>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll(
      '[aria-label], [role], [aria-busy], [aria-live], [aria-labelledby], label, h1, h2, h3, section, dl, ul, time, [data-testid]'
    ),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-busy') ?? ''}|${el.getAttribute('aria-live') ?? ''}|${el.getAttribute('data-testid') ?? ''}`
  );
}

/** Every control, with its label, state and whether it can be pressed. */
function controls(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button, input, select, a, summary')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const pressed = el.getAttribute('aria-pressed');
    const selected = el.getAttribute('aria-selected');
    const name = normalize(el.getAttribute('aria-label') ?? el.textContent ?? '');
    const href = el.tagName === 'A' ? ` ->${el.getAttribute('href')}` : '';
    const title = el.getAttribute('title');
    return `${el.tagName.toLowerCase()}|${name}${href}${pressed ? ` [pressed=${pressed}]` : ''}${selected ? ` [selected=${selected}]` : ''}${title ? ` [title=${title}]` : ''}${disabled}`;
  });
}

function text(root: HTMLElement): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return normalize(words.join(' '));
}

function zoneFree({ figures, hooks }: { figures: string[]; hooks: string[] }) {
  return { figures: figures.map(normalize), hooks: hooks.map(normalize) };
}

/** The page without the mast the pass adds (none on the old page). */
function page(container: HTMLElement): HTMLElement {
  const root = container.querySelector('.tournament-details') as HTMLElement;
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.arena-workspace-mast').forEach((el) => el.remove());
  return copy;
}

function pin(container: HTMLElement) {
  const root = page(container);
  return {
    root: {
      role: root.getAttribute('role'),
      busy: root.getAttribute('aria-busy'),
      tab: root.getAttribute('data-active-tab'),
      embedded: root.getAttribute('data-embedded'),
    },
    money: zoneFree(moneyFigures(root)),
    text: text(root),
    regions: regions(root),
    controls: controls(root),
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(NOW);
  fixture.user = { id: 'viewer' };
  fixture.queries.length = 0;
  fixture.navigate.mockClear();
  fixture.register.mockReset().mockResolvedValue({ ok: true });
  fixture.getTournament.mockReset().mockImplementation(async () => tournament());
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

afterEach(() => {
  cleanup();
  __resetServerClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the tournament details page prints the same figures, words and controls', () => {
  it('registering, not registered: Register is the footer control', async () => {
    const { container } = await show();
    expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
          "button|Register",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "<date>, <time> - 0 Registered",
            "110",
            "5,000",
            "0",
            "20,000",
            "1",
            "100 / 200",
            "150 / 300",
            "Lv 6",
            "7 Min",
            "0",
            "0",
            "of 0 entries",
            "20,000",
            "0",
            "0",
            "1",
            "Lv 6",
            "1,200",
            "5,000 GTD",
            "0",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "End Of Level 6",
            "0",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "section||Tournament Starts In|||",
          "h3|||||",
          "dl|||||",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Registering 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 Details Satellites Blinds Ranking Entries Unions Tables Rewards Tournament Starts In <time> <date>, <time> - 0 Registered Buy-In 110 Chips Guaranteed 5,000 Entries 0 Starting Stack 20,000 Level 1 Blinds 100 / 200 Next 150 / 300 Late Reg Lv 6 Levels 7 Min Tables 0 Remaining 0 of 0 entries Avg Stack 20,000 Total Chips 0 Tables 0 Level 1 Blinds Up - Late Reg Lv 6 Prize Pool 1,200 5,000 GTD Eliminated 0 Freezeout Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes End Of Level 6 Add-On No Starts <date>, <time> Entries 0 Satellite Details No Satellites Available For This Tournament Copy Link Register",
      }
    `);
  });

  it('registering, registered: Unregister on the same plate', async () => {
    rows('tournament_players_public', { data: [entry()], error: null });
    const { container } = await show();
    expect(screen.getByRole('button', { name: 'Unregister' })).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
          "button|Unregister",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "<date>, <time> - 1 Registered",
            "110",
            "5,000",
            "1",
            "20,000",
            "1",
            "100 / 200",
            "150 / 300",
            "Lv 6",
            "7 Min",
            "0",
            "1",
            "of 1 entries",
            "20,000",
            "20,000",
            "0",
            "1",
            "Lv 6",
            "1,200",
            "5,000 GTD",
            "0",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "End Of Level 6",
            "1",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "section||Tournament Starts In|||",
          "h3|||||",
          "dl|||||",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Registering 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 Details Satellites Blinds Ranking Entries Unions Tables Rewards Tournament Starts In <time> <date>, <time> - 1 Registered Buy-In 110 Chips Guaranteed 5,000 Entries 1 Starting Stack 20,000 Level 1 Blinds 100 / 200 Next 150 / 300 Late Reg Lv 6 Levels 7 Min Tables 0 Remaining 1 of 1 entries Avg Stack 20,000 Total Chips 20,000 Tables 0 Level 1 Blinds Up - Late Reg Lv 6 Prize Pool 1,200 5,000 GTD Eliminated 0 Freezeout You Are In Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes End Of Level 6 Add-On No Starts <date>, <time> Entries 1 Satellite Details No Satellites Available For This Tournament Copy Link Unregister",
      }
    `);
  });

  it('Register still calls the registration hook once', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await flush();
    expect(fixture.register).toHaveBeenCalledTimes(1);
  });

  it('running in late registration, not registered: Late Register with its countdown', async () => {
    fixture.getTournament.mockImplementation(async () =>
      tournament({
        status: 'LATE_REG',
        late_reg_levels: null,
        late_reg_mins: 30,
        started_at: new Date(NOW - 5 * 60_000).toISOString(),
        prize_pool: 4400,
        current_players: 40,
      })
    );
    rows('tables', { data: [{ id: 'table-1', status: 'playing' }], error: null });
    const { container } = await show();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels",
          "button|Late Register, 25 Mins Remaining",
          "button|WATCH [title=Watch The Featured Table]",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
          "button|Late Register, 25 Mins Remaining",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels",
            "a1b2c3d4",
            "25 Mins Remaining",
            "150 / 300",
            "110",
            "5,000",
            "0",
            "20,000",
            "0",
            "of 0 entries",
            "20,000",
            "0",
            "1",
            "2",
            "30m",
            "4,400",
            "5,000 GTD",
            "0",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "30 Min After Start · Estimated <date>, <time> <zone>",
            "0",
            "0h 5m 0s",
            "25 Mins Remaining",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "button||Late Register, 25 Mins Remaining|||",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "div||||off|",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
          "button||Late Register, 25 Mins Remaining|||",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Late Registration 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels Deep Stack Sunday Event ID: a1b2c3d4 Late Register 25 Mins Remaining WATCH Details Satellites Blinds Ranking Entries Unions Tables Rewards Late Reg Ends In <time> Running Since <date>, <time> Blinds 150 / 300 No Ante Next - Buy-In 110 Chips Guaranteed 5,000 Entries 0 Starting Stack 20,000 Remaining 0 of 0 entries Avg Stack 20,000 Total Chips 0 Tables 1 Level 2 Blinds Up <time> Late Reg 30m Prize Pool 4,400 5,000 GTD Eliminated 0 Freezeout Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes 30 Min After Start · Estimated <date>, <time> <zone> Add-On No Started <date>, <time> Entries 0 Running Time 0h 5m 0s Satellite Details No Satellites Available For This Tournament Copy Link Late Register 25 Mins Remaining",
      }
    `);
  });

  it('running, seated: Take Seat to the player table', async () => {
    fixture.getTournament.mockImplementation(async () =>
      tournament({
        status: 'RUNNING',
        started_at: new Date(NOW - 90 * 60_000).toISOString(),
        current_level: 9,
        prize_pool: 4400,
      })
    );
    rows('tournament_players_public', {
      data: [entry({ status: 'playing', table_id: 'table-1', chips: 31500 })],
      error: null,
    });
    rows('tables', { data: [{ id: 'table-1', status: 'playing' }], error: null });
    const { container } = await show();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "a|TAKE SEAT ->/table/table-1",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "110",
            "5,000",
            "1",
            "20,000",
            "1",
            "of 1 entries",
            "31,500",
            "31,500",
            "1",
            "10",
            "4,400",
            "5,000 GTD",
            "0",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "Closed · End Of Level 6",
            "1",
            "1h 30m 0s",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-discover=true",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "div||||off|",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Running 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 TAKE SEAT Details Satellites Blinds Ranking Entries Unions Tables Rewards Registration Closed - Running Since <date>, <time> Blinds - Current Blinds Unavailable Next - Buy-In 110 Chips Guaranteed 5,000 Entries 1 Starting Stack 20,000 Remaining 1 of 1 entries Avg Stack 31,500 Total Chips 31,500 Tables 1 Level 10 Blinds Up <time> Late Reg Closed Prize Pool 4,400 5,000 GTD Eliminated 0 Freezeout You Are In Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes Closed · End Of Level 6 Add-On No Started <date>, <time> Entries 1 Running Time 1h 30m 0s Satellite Details No Satellites Available For This Tournament Copy Link",
      }
    `);
  });

  it('running, eliminated: the badge and Watch', async () => {
    fixture.getTournament.mockImplementation(async () =>
      tournament({
        status: 'RUNNING',
        started_at: new Date(NOW - 90 * 60_000).toISOString(),
        current_level: 9,
        prize_pool: 4400,
      })
    );
    rows('tournament_players_public', {
      data: [entry({ status: 'eliminated', chips: 0, finish_position: 31 })],
      error: null,
    });
    rows('tables', { data: [{ id: 'table-2', status: 'playing' }], error: null });
    const { container } = await show();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "button|WATCH [title=Watch The Featured Table]",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "110",
            "5,000",
            "1",
            "20,000",
            "0",
            "of 1 entries",
            "20,000",
            "20,000",
            "1",
            "10",
            "4,400",
            "5,000 GTD",
            "1",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "Closed · End Of Level 6",
            "1",
            "1h 30m 0s",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "div||||off|",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Running 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 ELIMINATED WATCH Details Satellites Blinds Ranking Entries Unions Tables Rewards Registration Closed - Running Since <date>, <time> Blinds - Current Blinds Unavailable Next - Buy-In 110 Chips Guaranteed 5,000 Entries 1 Starting Stack 20,000 Remaining 0 of 1 entries Avg Stack 20,000 Total Chips 20,000 Tables 1 Level 10 Blinds Up <time> Late Reg Closed Prize Pool 4,400 5,000 GTD Eliminated 1 Freezeout You Are In Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes Closed · End Of Level 6 Add-On No Started <date>, <time> Entries 1 Running Time 1h 30m 0s Satellite Details No Satellites Available For This Tournament Copy Link",
      }
    `);
  });

  it('finished', async () => {
    fixture.getTournament.mockImplementation(async () =>
      tournament({
        status: 'COMPLETED',
        started_at: new Date(NOW - 300 * 60_000).toISOString(),
        ended_at: new Date(NOW - 10 * 60_000).toISOString(),
        prize_pool: 4400,
      })
    );
    const { container } = await show();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "0",
            "0",
            "4,400",
            "5,000 GTD",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "Closed · End Of Level 6",
            "0",
            "4h 50m 0s",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "h3|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "false",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Completed 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 Completed Details Satellites Blinds Ranking Entries Unions Tables Rewards Final Results 0 Entries Results Are Being Finalised Check Back In A Moment Entries 0 Prize Pool 4,400 5,000 GTD Places Paid - Freezeout Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes Closed · End Of Level 6 Add-On No Ended <date>, <time> Entries 0 Running Time 4h 50m 0s Satellite Details No Satellites Available For This Tournament Copy Link",
      }
    `);
  });

  it('empty: Tournament Not Found with the way back', async () => {
    fixture.getTournament.mockImplementation(async () => null);
    const { container } = await show();
    expect(screen.getByText('Tournament Not Found')).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a|Back To Clubs ->/clubs",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-discover=true",
          ],
        },
        "regions": [
          "h2|||||",
        ],
        "root": {
          "busy": null,
          "embedded": null,
          "role": null,
          "tab": null,
        },
        "text": "Tournament Not Found Back To Clubs",
      }
    `);
  });

  it('empty: a link from a club not joined offers the join step', async () => {
    fixture.getTournament.mockImplementation(async () => null);
    const { container } = await show({ search: '?i=K7MQ2XR' });
    expect(screen.getByRole('button', { name: 'Join Club & Open Tournament' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back To Clubs' })).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Back To Clubs",
          "button|Join Club & Open Tournament",
        ],
        "money": {
          "figures": [],
          "hooks": [
            "data-testid=tournament-club-join-copy",
          ],
        },
        "regions": [
          "div|alert||||",
          "h2|||||",
          "p|||||tournament-club-join-copy",
        ],
        "root": {
          "busy": null,
          "embedded": null,
          "role": null,
          "tab": null,
        },
        "text": "The Tournament Join The Club First Invite This Tournament Belongs To A Club You Have Not Joined Yet, Or It Has Closed. Join The Club With This Invite To Open It. Joining Charges Nothing And Registers You For Nothing. Back To Clubs Join Club & Open Tournament",
      }
    `);
  });

  it('error: a failed read offers Try Again', async () => {
    fixture.getTournament.mockImplementation(async () => {
      throw new Error('read failed');
    });
    const { container } = await show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    await flush();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Try Again",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|alert||||",
        ],
        "root": {
          "busy": null,
          "embedded": null,
          "role": null,
          "tab": null,
        },
        "text": "Tournament Details Could Not Be Loaded. Try Again",
      }
    `);
  });

  it('loading', async () => {
    fixture.getTournament.mockImplementation(() => new Promise(() => {}));
    const { container } = await show();
    expect(screen.getByText('Loading Tournament...')).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "root": {
          "busy": "true",
          "embedded": null,
          "role": "status",
          "tab": null,
        },
        "text": "Loading Tournament...",
      }
    `);
  });

  it('the in-game popup: registering, with its close control', async () => {
    const { container } = await show({ onClose: vi.fn() });
    expect(screen.getByRole('button', { name: 'Close Tournament Lobby' })).toBeTruthy();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|Invite To Game",
          "button|Close Tournament Lobby",
          "summary|20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
          "button|Details [selected=true]",
          "button|Satellites [selected=false]",
          "button|Blinds [selected=false]",
          "button|Ranking [selected=false]",
          "button|Entries [selected=false]",
          "button|Unions [selected=false]",
          "button|Tables [selected=false]",
          "button|Rewards [selected=false]",
          "button|Copy Link",
          "button|Register",
        ],
        "money": {
          "figures": [
            "5,000",
            "110 Chips · 100 + 10",
            "20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6",
            "a1b2c3d4",
            "<date>, <time> - 0 Registered",
            "110",
            "5,000",
            "0",
            "20,000",
            "1",
            "100 / 200",
            "150 / 300",
            "Lv 6",
            "7 Min",
            "0",
            "0",
            "of 0 entries",
            "20,000",
            "0",
            "0",
            "1",
            "Lv 6",
            "1,200",
            "5,000 GTD",
            "0",
            "110 (100 + 10)",
            "20,000 · 100 BB",
            "7 Min",
            "End Of Level 6",
            "0",
          ],
          "hooks": [
            "data-format=turbo",
            "data-testid=tournament-invite-btn",
            "data-testid=tournament-footer-invite-btn",
          ],
        },
        "regions": [
          "h1|||||",
          "button|||||tournament-invite-btn",
          "button||Close Tournament Lobby|||",
          "div|tablist|Tournament Sections|||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "button|tab||||",
          "div|tabpanel||||",
          "section||Tournament Overview|||",
          "section||Tournament Starts In|||",
          "h3|||||",
          "dl|||||",
          "dl|||||",
          "div||Tournament Rules|||",
          "h3|||||",
          "dl|||||",
          "h3|||||",
          "button|||||tournament-footer-invite-btn",
        ],
        "root": {
          "busy": null,
          "embedded": "true",
          "role": null,
          "tab": "detail",
        },
        "text": "Sunday Major 5,000 Guaranteed Registering 110 Chips · 100 + 10 Invite To Game 20,000 Starting Stack · 7 Min Levels · Late Reg Through Lv 6 Deep Stack Sunday Event ID: a1b2c3d4 Details Satellites Blinds Ranking Entries Unions Tables Rewards Tournament Starts In <time> <date>, <time> - 0 Registered Buy-In 110 Chips Guaranteed 5,000 Entries 0 Starting Stack 20,000 Level 1 Blinds 100 / 200 Next 150 / 300 Late Reg Lv 6 Levels 7 Min Tables 0 Remaining 0 of 0 entries Avg Stack 20,000 Total Chips 0 Tables 0 Level 1 Blinds Up - Late Reg Lv 6 Prize Pool 1,200 5,000 GTD Eliminated 0 Freezeout Tournament Details Game NLH Buy-In 110 (100 + 10) Starting Stack 20,000 · 100 BB Structure Regular Levels 7 Min Rebuy None Late Registration Closes End Of Level 6 Add-On No Starts <date>, <time> Entries 0 Satellite Details No Satellites Available For This Tournament Copy Link Register",
      }
    `);
  });
});
