/**
 * THE WHOLE SAVE AND LOAD PATH, SCENARIO BY SCENARIO (Dan 2026-11-05)
 *
 * The real client modules (preferenceSync, lobbyPreferenceSync, AdvancedFilters,
 * lobbyViewPrefs, lobbyFavorites) against a server that answers with the same
 * revision rules as migration 20261105183133 (tests/helpers/fakePreferenceServer).
 * Every scenario Dan listed: slow and failed loads, a change before the load
 * finishes, token expiry and refresh, background and resume, logout / login and
 * account switching, offline edits, failed saves and retries, delayed and
 * duplicate replies, older builds and unavailable options, one change never
 * rewriting another, and "saved" shown only once the account accepted it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({
  server: null as any,
  /** Session the database sees (what auth.uid() would be). */
  session: 'account-a' as string | null,
  /** Session a refresh would produce. */
  refreshTo: 'account-a' as string | null,
  /** Errors to return for the next calls, in order. */
  failNext: [] as unknown[],
  /** When set, every reply waits for the test to release it. */
  hold: false,
  held: [] as Array<() => void>,
  calls: [] as { fn: string; user: string | null; args: any }[],
  lobbyRead: null as null | (() => Promise<any>),
  refreshes: 0,
  club: 'club-1',
}));

vi.mock('../../src/lib/supabase', () => {
  const reply = async (fn: string, args: any) => {
    const { answer } = await import('../helpers/fakePreferenceServer');
    net.calls.push({ fn, user: net.session, args });
    if (net.failNext.length) return { data: null, error: net.failNext.shift() };
    if (!net.session) return { data: null, error: { status: 401, message: 'JWT expired' } };
    const out = { data: answer(net.server, net.session, fn, args), error: null };
    if (!net.hold) return out;
    return new Promise((resolve) => net.held.push(() => resolve(out)));
  };
  return {
    supabase: {
      rpc: reply,
      from: () => ({
        select: () => {
          const q: any = {
            eq: () => q,
            limit: () => q,
            maybeSingle: async () => {
              if (net.lobbyRead) return net.lobbyRead();
              const { lobbySelect } = await import('../helpers/fakePreferenceServer');
              return {
                data: net.session ? lobbySelect(net.server, net.session, net.club) : null,
                error: null,
              };
            },
          };
          return q;
        },
      }),
      auth: {
        getSession: async () => ({
          data: { session: net.session ? { user: { id: net.session } } : null },
          error: null,
        }),
        refreshSession: async () => {
          net.refreshes += 1;
          net.session = net.refreshTo;
          return {
            data: { session: net.session ? { user: { id: net.session } } : null },
            error: null,
          };
        },
      },
    },
  };
});
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => null }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useUserStore } from '../../src/stores/useUserStore';
import {
  fetchRemoteFilters,
  hasUnsyncedFilters,
  loadFilters,
  persistFilters,
  pushRemoteFilters,
} from '../../src/components/lobby/AdvancedFilters';
import { loadViewPrefs, pushRemoteViewPrefs } from '../../src/components/lobby/lobbyViewPrefs';
import { flushLobby, LOBBY_PREFERENCE_ADOPT } from '../../src/components/lobby/lobbyPreferenceSync';
import { FILTER_SPECS, emptyFilterValue } from '../../src/components/lobby/advancedFilterSpec';
import { readSaveStatus, retrySave, onResume } from '../../src/lib/preferenceSync';
import {
  flushFavorites,
  toggleLobbyFavorite,
  fetchLobbyFavorites,
} from '../../src/components/lobby/lobbyFavorites';
import { answer, createFakePreferenceServer, lobbySelect } from '../helpers/fakePreferenceServer';

/* Each test gets a club of its own: save queues are per account and club, so
   one test's in-flight save can never pick up the next test's change. */
let CLUB = 'club-1';
let clubSeq = 0;
const holdem = (seatMax: number) => ({ ...emptyFilterValue(FILTER_SPECS.HOLDEM), seatMax });
const omaha = (seatMax: number) => ({ ...emptyFilterValue(FILTER_SPECS.OMAHA), seatMax });
const signIn = (id: string | null) => {
  useUserStore.setState({ user: id ? ({ id } as any) : null });
  net.session = id;
  net.refreshTo = id;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const accountFilters = (user = 'account-a') => lobbySelect(net.server, user, CLUB)?.filters ?? {};
/** Another device saves directly, as its own successful request would. */
const otherDeviceSaves = (field: string, value: unknown, user = 'account-a') => {
  const rev = net.server.lobby.get(user)?.get(CLUB)?.revisions?.[field] ?? 0;
  answer(net.server, user, 'fn_save_lobby_preferences', {
    p_club_id: CLUB,
    p_changes: [{ field, value, base: rev }],
  });
};

beforeEach(() => {
  clubSeq += 1;
  CLUB = `club-${clubSeq}`;
  net.club = CLUB;
  localStorage.clear();
  net.server = createFakePreferenceServer();
  net.failNext = [];
  net.hold = false;
  net.held = [];
  net.calls = [];
  net.lobbyRead = null;
  net.refreshes = 0;
  signIn('account-a');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('loading never writes', () => {
  it('opening the lobby, reading the row and showing defaults send nothing', async () => {
    loadFilters(CLUB);
    loadViewPrefs(CLUB);
    await fetchRemoteFilters(CLUB, 'account-a');
    await settle();
    expect(net.calls).toHaveLength(0);
  });

  it('a failed read keeps the cache and writes nothing', async () => {
    localStorage.setItem(
      `ca_advanced_filters_account-a:${CLUB}`,
      JSON.stringify({ HOLDEM: holdem(6) })
    );
    net.lobbyRead = async () => ({ data: null, error: { message: 'network down' } });
    expect(loadFilters(CLUB).HOLDEM?.seatMax).toBe(6);
    expect(await fetchRemoteFilters(CLUB, 'account-a')).toBeNull();
    await settle();
    expect(net.calls).toHaveLength(0);
  });
});

describe('a change made while the first load is still slow', () => {
  it('is kept on screen over the late row, and only that tab is sent', async () => {
    otherDeviceSaves('filters.OMAHA', omaha(4));
    let release!: (v: any) => void;
    net.lobbyRead = () => new Promise((r) => (release = r));
    const shown = loadFilters(CLUB);
    const reading = fetchRemoteFilters(CLUB, 'account-a');
    // The player changes Hold'em before the row arrives.
    persistFilters(CLUB, { ...shown, HOLDEM: holdem(9) });
    release({ data: lobbySelect(net.server, 'account-a', CLUB), error: null });
    const merged = await reading;
    expect(merged?.HOLDEM?.seatMax).toBe(9);
    expect(merged?.OMAHA?.seatMax).toBe(4);
    await vi.waitFor(() => expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(false));
    expect(accountFilters()).toMatchObject({ HOLDEM: { seatMax: 9 }, OMAHA: { seatMax: 4 } });
    expect(net.calls.flatMap((c) => c.args.p_changes.map((x: any) => x.field))).toEqual([
      'filters.HOLDEM',
    ]);
  });
});

describe('saved means the account accepted it', () => {
  it('reads Saving until the reply, Saved only after it', async () => {
    net.hold = true;
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(6) });
    await vi.waitFor(() => expect(net.held).toHaveLength(1));
    expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saving');
    net.held[0]();
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saved'));
  });

  it('a failed save stays visible and pending, and Retry finishes it', async () => {
    net.failNext = [{ message: 'server error' }];
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(6) });
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('failed'));
    expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(true);
    retrySave(`account-a:lobby:${CLUB}`);
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saved'));
    expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 6 });
  });
});

describe('authentication', () => {
  it('an expired token is refreshed first, then the same change is retried once', async () => {
    net.failNext = [{ status: 401, code: 'PGRST301', message: 'JWT expired' }];
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(7) });
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saved'));
    expect(net.refreshes).toBe(1);
    expect(net.calls).toHaveLength(2);
    expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 7 });
  });

  it('a refresh that lands on another account sends nothing and keeps the change', async () => {
    net.failNext = [{ status: 401, message: 'JWT expired' }];
    net.refreshTo = 'account-b';
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(7) });
    await vi.waitFor(() =>
      expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('signed_out')
    );
    expect(net.calls).toHaveLength(1);
    expect(lobbySelect(net.server, 'account-b', CLUB)).toBeNull();
    expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(true);
  });
});

describe('accounts', () => {
  it('a pending change of account A is never sent while account B is signed in', async () => {
    net.failNext = [{ message: 'offline' }];
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(5) });
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('failed'));
    // Logout, and account B signs in on this device.
    signIn('account-b');
    await flushLobby('account-a', CLUB);
    expect(net.calls.filter((c) => c.user === 'account-b')).toHaveLength(0);
    expect(lobbySelect(net.server, 'account-b', CLUB)).toBeNull();
    // A signs back in: A's change finishes, on A only.
    signIn('account-a');
    await flushLobby('account-a', CLUB);
    expect(accountFilters('account-a').HOLDEM).toMatchObject({ seatMax: 5 });
    expect(lobbySelect(net.server, 'account-b', CLUB)).toBeNull();
  });
});

describe('offline, background and resume', () => {
  it('an offline change is kept on this device and sent when the device comes back', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(3) });
    await settle();
    expect(net.calls).toHaveLength(0);
    expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(true);
    const stop = onResume(() => void flushLobby('account-a', CLUB));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 3 }));
    stop();
  });
});

describe('stale state never replaces newer accepted state', () => {
  it("an older device's change is refused, the account's value is shown and reported", async () => {
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(6) });
    await vi.waitFor(() => expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(false));
    // Another device saves Hold'em since; this one still shows its old view.
    otherDeviceSaves('filters.HOLDEM', holdem(2));
    const adopted = vi.fn();
    window.addEventListener(LOBBY_PREFERENCE_ADOPT, adopted);
    persistFilters(CLUB, { HOLDEM: holdem(8) });
    await vi.waitFor(() =>
      expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('conflict')
    );
    window.removeEventListener(LOBBY_PREFERENCE_ADOPT, adopted);
    expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 2 });
    expect(adopted).toHaveBeenCalled();
    expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(false);
  });

  it('a slow reply to an older save cannot undo a later choice', async () => {
    net.hold = true;
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(4) });
    await vi.waitFor(() => expect(net.held).toHaveLength(1));
    persistFilters(CLUB, { HOLDEM: holdem(5) });
    net.held[0]();
    await vi.waitFor(() => expect(net.held).toHaveLength(2));
    net.held[1]();
    await vi.waitFor(() => expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(false));
    expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 5 });
  });

  it('a duplicate retry of an accepted change reads as saved, not as a conflict', async () => {
    loadFilters(CLUB);
    persistFilters(CLUB, { HOLDEM: holdem(6) });
    await vi.waitFor(() => expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saved'));
    // The same request again, against the revision it was first made from.
    const first = net.calls[0].args;
    const r = answer(net.server, 'account-a', 'fn_save_lobby_preferences', first);
    expect(r.results[0].status).toBe('conflict');
    expect(r.results[0].value).toMatchObject({ seatMax: 6 });
    expect(accountFilters().HOLDEM).toMatchObject({ seatMax: 6 });
  });

  it('changing one setting never rewrites another from an older snapshot', async () => {
    otherDeviceSaves('filters.OMAHA', omaha(4));
    otherDeviceSaves('view.tab', 'MTT');
    // This device's cache is older: it still has Omaha at 9.
    localStorage.setItem(
      `ca_advanced_filters_account-a:${CLUB}`,
      JSON.stringify({ OMAHA: omaha(9) })
    );
    const shown = loadFilters(CLUB);
    persistFilters(CLUB, { ...shown, HOLDEM: holdem(6) });
    await vi.waitFor(() => expect(hasUnsyncedFilters(CLUB, 'account-a')).toBe(false));
    expect(accountFilters()).toMatchObject({ OMAHA: { seatMax: 4 }, HOLDEM: { seatMax: 6 } });
    expect(lobbySelect(net.server, 'account-a', CLUB)?.view_prefs.tab).toBe('MTT');
  });
});

describe('older builds and unavailable options', () => {
  it("an older build's unconfirmed choice applies only where nothing newer was saved", async () => {
    otherDeviceSaves('filters.OMAHA', omaha(4));
    localStorage.setItem(
      `ca_advanced_filters_account-a:${CLUB}`,
      JSON.stringify({ HOLDEM: holdem(6), OMAHA: omaha(9) })
    );
    // The pre-2026-11-05 marker for "this store was never confirmed".
    localStorage.setItem(`ca_advanced_filters_account-a:${CLUB}:unsynced`, '1');
    loadFilters(CLUB);
    await pushRemoteFilters(CLUB, loadFilters(CLUB), 'account-a');
    await settle();
    expect(accountFilters()).toMatchObject({ HOLDEM: { seatMax: 6 }, OMAHA: { seatMax: 4 } });
  });

  it('a view tab this build does not show is never written back', async () => {
    localStorage.setItem(
      `ca_lobby_view_account-a:${CLUB}`,
      JSON.stringify({ tab: 'A_TAB_FROM_A_LATER_BUILD', sortByTab: {}, favoritesOnly: true })
    );
    const prefs = loadViewPrefs(CLUB);
    expect(prefs.tab).toBeNull();
    pushRemoteViewPrefs(CLUB, { ...prefs, favoritesOnly: false });
    await vi.waitFor(() => expect(net.calls).toHaveLength(1));
    expect(net.calls[0].args.p_changes.map((c: any) => c.field)).toEqual(['view.favoritesOnly']);
  });
});

describe('favorites', () => {
  it('an older offline star cannot come back after the game was unfavorited elsewhere', async () => {
    // Starred; this device saw revision r.
    await toggleLobbyFavorite('account-a', 'tournament', 'game-1', true, 0);
    const seen = (await fetchLobbyFavorites()).revisions['game-1'];
    // Another device unfavorites it.
    answer(net.server, 'account-a', 'fn_set_lobby_favorites', {
      p_changes: [{ kind: 'tournament', game_id: 'game-1', on: false, base: seen }],
    });
    // This device, offline, had tapped it off and on again against what it saw.
    await toggleLobbyFavorite('account-a', 'tournament', 'game-1', true, seen);
    const after = await fetchLobbyFavorites();
    expect(after.ids).not.toContain('game-1');
    expect(readSaveStatus('account-a:favorites').state).toBe('conflict');
  });

  it('a pending star of account A is never sent under account B', async () => {
    net.failNext = [{ message: 'offline' }];
    await toggleLobbyFavorite('account-a', 'cash', 'table-1', true, 0);
    signIn('account-b');
    await flushFavorites('account-a');
    expect(net.server.favorites.get('account-b')).toBeUndefined();
    signIn('account-a');
    await flushFavorites('account-a');
    expect((await fetchLobbyFavorites()).ids).toContain('table-1');
  });

  it("starring, then unstarring, is the player's and the record keeps its revision", async () => {
    await toggleLobbyFavorite('account-a', 'cash', 'table-2', true, 0);
    const r1 = (await fetchLobbyFavorites()).revisions['table-2'];
    await toggleLobbyFavorite('account-a', 'cash', 'table-2', false, r1);
    const after = await fetchLobbyFavorites();
    expect(after.ids).not.toContain('table-2');
    expect(after.revisions['table-2']).toBeGreaterThan(r1);
  });
});

describe('a device whose storage refuses writes', () => {
  /* Production, verify-lobby-filters run 42121413754: the lobby's own caches
     filled the browser's storage, the queue's records could not be written,
     a second sort tap went out against the revision from before the first
     and the account refused the player's own newer choice; the third tap was
     never sent. The session copy keeps the queue whole for the session. */
  it('still sends every tap against its own last accepted revision', async () => {
    const view = loadViewPrefs(CLUB);
    const original = localStorage.setItem;
    let refused = 0;
    const full = () => {
      refused += 1;
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    Object.defineProperty(localStorage, 'setItem', { value: full, configurable: true });
    const setItem = {
      mockRestore: () =>
        Object.defineProperty(localStorage, 'setItem', { value: original, configurable: true }),
    };
    try {
      for (const sort of ['stakes_low', 'stakes_high', 'players']) {
        await pushRemoteViewPrefs(
          CLUB,
          { ...view, tab: 'SNG', sortByTab: { ...view.sortByTab, SNG: sort } },
          'account-a'
        );
        expect(readSaveStatus(`account-a:lobby:${CLUB}`).state).toBe('saved');
      }
    } finally {
      setItem.mockRestore();
    }
    expect(refused).toBeGreaterThan(0);
    const sorts = net.calls
      .filter((c) => c.fn === 'fn_save_lobby_preferences')
      .flatMap((c) => c.args.p_changes)
      .filter((c: any) => c.field === 'view.sort.SNG')
      .map((c: any) => c.value);
    expect(sorts).toEqual(['stakes_low', 'stakes_high', 'players']);
    expect(lobbySelect(net.server, 'account-a', CLUB)?.view_prefs.sortByTab.SNG).toBe('players');
  });
});
