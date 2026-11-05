/**
 * A LOBBY PREFERENCE IS FINISHED WHEN THE ROW HAS IT (2026-10-16)
 *
 * Four defects in the cross-device lobby preferences, each pinned here:
 *   1. A save the network dropped left the row one choice behind, and the next
 *      lobby open let that older row overwrite the newer choice on the device.
 *   2. Advanced Filters were cached per club only, so one account's filters
 *      survived sign-out and silently filtered the next account's lobby.
 *   3. The lobby's quick chips wrote only this browser's cache, and the lobby
 *      never read the row at all, so filters followed the player only while
 *      the filter sheet happened to be open.
 *   4. A request the browser abandoned (navigation) was reported as an error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  writes: [] as Array<{ payload: any; resolve: (v: any) => void; reject: (e: any) => void }>,
  session: { userId: 'account-a' } as { userId: string } | null,
  server: null as any,
}));

/* Every save is fn_save_lobby_preferences (2026-11-05). Each request waits
   until the test resolves it; a success is answered by the fake server with
   the same revision rules as the database. */
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, payload: any) =>
      new Promise((resolve, reject) =>
        state.writes.push({
          payload,
          resolve: async (r: any) => {
            if (r?.error) return resolve({ data: null, error: r.error });
            const { answer } = await import('../helpers/fakePreferenceServer');
            resolve({ data: answer(state.server, 'account-a', fn, payload), error: null });
          },
          reject,
        })
      ),
  },
}));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => state.session }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/errorReporter', () => ({ reportError }));

import {
  hasUnsyncedViewPrefs,
  isAbortedRequest,
  pushRemoteViewPrefs,
} from '../../src/components/lobby/lobbyViewPrefs';
import {
  hasUnsyncedFilters,
  loadFilters,
  persistFilters,
  pushRemoteFilters,
  saveFilters,
  stageFilters,
} from '../../src/components/lobby/AdvancedFilters';
import { FILTER_SPECS, emptyFilterValue } from '../../src/components/lobby/advancedFilterSpec';
import { useUserStore } from '../../src/stores/useUserStore';
/** The value a save sent for one field (only changed fields are sent). */
const sent = (write: { payload: any }, field: string) =>
  write.payload.p_changes.find((c: any) => c.field === field)?.value;

const GAME_A = FILTER_SPECS.HOLDEM.games![0].key;
const GAME_B = FILTER_SPECS.HOLDEM.games![1].key;

const plo = { tab: 'OMAHA' as const, sortByTab: {}, favoritesOnly: false };
const holdem = { ...plo, tab: 'HOLDEM' as const };
const settle = () => new Promise((r) => setTimeout(r, 0));
// The write queues are module-level per account+club, so every test gets a
// club of its own and an unresolved request in one cannot hold up the next.
let clubSeq = 0;
let club = 'club-0';

beforeEach(async () => {
  const { createFakePreferenceServer } = await import('../helpers/fakePreferenceServer');
  state.server = createFakePreferenceServer();
  useUserStore.setState({ user: { id: 'account-a' } as any });
  localStorage.clear();
  state.writes.length = 0;
  state.session = { userId: 'account-a' };
  reportError.mockClear();
  clubSeq += 1;
  club = `club-${clubSeq}`;
});

describe('an unconfirmed tab/sort choice is never overwritten by the older row', () => {
  it('stays unsynced after a failed save and is cleared by the next confirmed save', async () => {
    pushRemoteViewPrefs(club, plo, 'account-a');
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(true);
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));

    state.writes[0].resolve({ error: { message: 'network down' } });
    await settle();
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(true);

    pushRemoteViewPrefs(club, plo, 'account-a');
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(1));

    state.writes[1].resolve({ error: null });
    await settle();
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(false);
  });

  it('only the newest queued choice can declare the device synced', async () => {
    pushRemoteViewPrefs(club, holdem, 'account-a');
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));
    // The PLO tap lands while the Hold'em save is still in flight.
    pushRemoteViewPrefs(club, plo, 'account-a');
    state.writes[0].resolve({ error: null });
    await settle();
    // The PLO tap has not reached the row yet.
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(true);
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(1));
    expect(sent(state.writes[1], 'view.tab')).toBe('OMAHA');
    state.writes[1].resolve({ error: null });
    await settle();
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(false);
  });

  it('is kept per account', () => {
    pushRemoteViewPrefs(club, plo, 'account-a');
    expect(hasUnsyncedViewPrefs(club, 'account-b')).toBe(false);
  });

  // 2026-11-05: the unconfirmed write is finished FIRST, keeping the time it
  // was made, and only then is the row read back (the database keeps the newer
  // choice, so a newer pick from another device is what the screen shows). A
  // replay that failed leaves the choice unconfirmed and the row unread.
  it('the lobby finishes the unconfirmed write, then reads the row back', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'src/pages/ClubHomePage.tsx'), 'utf8');
    const hydrate = page.slice(
      page.indexOf('const replay = hasUnsyncedViewPrefs(resolvedClubId'),
      page.indexOf(
        '.then((remote) => {',
        page.indexOf('const replay = hasUnsyncedViewPrefs(resolvedClubId')
      )
    );
    expect(hydrate).toMatch(
      /pushRemoteViewPrefs\(resolvedClubId, saved, currentUser\?\.id, \{ replay: true \}\)/
    );
    expect(hydrate).toMatch(
      /cancelled \|\| hasUnsyncedViewPrefs\(resolvedClubId, currentUser\?\.id\)\s*\?\s*null\s*:\s*fetchRemoteViewPrefs\(resolvedClubId, currentUser\?\.id\)/
    );
  });
});

describe('a navigation abort is the player leaving, not a failed save', () => {
  it('recognises the shapes the browser and PostgREST client produce', () => {
    expect(isAbortedRequest({ name: 'AbortError' })).toBe(true);
    expect(isAbortedRequest({ message: 'AbortError: The operation was aborted.' })).toBe(true);
    expect(isAbortedRequest({ message: 'permission denied' })).toBe(false);
    expect(isAbortedRequest(null)).toBe(false);
  });

  it('does not report an aborted save, and keeps it owed to the row', async () => {
    pushRemoteViewPrefs(club, plo, 'account-a');
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));

    state.writes[0].resolve({ error: { message: 'AbortError: The operation was aborted.' } });
    await settle();
    expect(reportError).not.toHaveBeenCalled();
    expect(hasUnsyncedViewPrefs(club, 'account-a')).toBe(true);
  });

  it('still reports a real failure', async () => {
    pushRemoteViewPrefs(club, plo, 'account-a');
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));

    state.writes[0].resolve({ error: { message: 'permission denied' } });
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe('Advanced Filters belong to one account', () => {
  const bomb = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), games: [GAME_A] } };

  it('keeps each account its own filters on a shared browser', () => {
    saveFilters(club, bomb, 'account-a');
    expect(loadFilters(club, 'account-a').HOLDEM?.games).toEqual([GAME_A]);
    expect(loadFilters(club, 'account-b')).toEqual({});
  });

  it('adopts a pre-account browser store for exactly one account', () => {
    localStorage.setItem(`ca_advanced_filters_${club}`, JSON.stringify(bomb));
    expect(loadFilters(club, 'account-a').HOLDEM?.games).toEqual([GAME_A]);
    expect(loadFilters(club, 'account-b')).toEqual({});
  });

  it('signed out still reads and writes the per-club key', () => {
    saveFilters(club, bomb, null);
    expect(localStorage.getItem(`ca_advanced_filters_${club}`)).toContain(GAME_A);
    expect(loadFilters(club, null).HOLDEM?.games).toEqual([GAME_A]);
  });
});

describe('every lobby filter change reaches the row, in order', () => {
  const a = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), games: [GAME_A] } };
  const b = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), games: [GAME_B] } };

  it('persistFilters writes the cache and the row', async () => {
    persistFilters(club, a);
    expect(loadFilters(club, 'account-a').HOLDEM?.games).toEqual([GAME_A]);
    await vi.waitFor(() => expect(state.writes).toHaveLength(1));
    expect(sent(state.writes[0], 'filters.HOLDEM').games).toEqual([GAME_A]);
    expect(hasUnsyncedFilters(club, 'account-a')).toBe(true);
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));

    state.writes[0].resolve({ error: null });
    await settle();
    expect(hasUnsyncedFilters(club, 'account-a')).toBe(false);
  });

  it('a slow earlier save never lands after the last tap', async () => {
    pushRemoteFilters(club, a);
    await vi.waitFor(() => expect(state.writes).toHaveLength(1));
    // The second tap lands while the first save is still in flight.
    pushRemoteFilters(club, b);
    expect(state.writes).toHaveLength(1);
    state.writes[0].resolve({ error: null });
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    expect(sent(state.writes[1], 'filters.HOLDEM').games).toEqual([GAME_B]);
    expect(hasUnsyncedFilters(club, 'account-a')).toBe(true);
    state.writes[1].resolve({ error: null });
    await settle();
    expect(hasUnsyncedFilters(club, 'account-a')).toBe(false);
  });

  it('the lobby writes no filter change to the cache alone, and reads the row on open', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'src/pages/ClubHomePage.tsx'), 'utf8');
    expect(page).not.toMatch(/if \(resolvedClubId\) saveFilters\(resolvedClubId, next\)/);
    expect(page.match(/persistAdvFilters\(resolvedClubId, next\)/g)?.length ?? 0).toBe(3);
    expect(page).not.toMatch(/onVariantsChange|onStylesChange/);
    const hydrate = page.slice(
      page.indexOf('const cached = loadFilters(resolvedClubId'),
      page.indexOf(
        '}, [resolvedClubId, currentUser?.id]);',
        page.indexOf('const cached = loadFilters(resolvedClubId')
      )
    );
    expect(hydrate).toMatch(/hasUnsyncedFilters\(resolvedClubId/);
    // The owner is passed explicitly (2026-11-05): an expired token must never
    // turn the push or the read into a signed-out no-op.
    expect(hydrate).toMatch(
      /pushRemoteFilters\(resolvedClubId, cached, currentUser\?\.id \?\? null\)/
    );
    expect(hydrate).toMatch(
      /return fetchRemoteFilters\(resolvedClubId, currentUser\?\.id \?\? null\)/
    );
    // No read while the replayed choice is still unconfirmed.
    expect(hydrate).toMatch(/cancelled \|\| hasUnsyncedFilters\(resolvedClubId/);
    expect(hydrate).toMatch(/advFiltersTouched\.current/);
  });
});

it('a newly staged slider choice remains pending when an older save finishes during debounce', async () => {
  const first = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), games: [GAME_A] } };
  const newer = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), games: [GAME_B] } };
  persistFilters(club, first);
  await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(0));
  // The slider moves again while the first save is in flight (debounced, unsent).
  stageFilters(club, newer, 'account-a');
  state.writes[0].resolve({ error: null });
  await settle();
  expect(hasUnsyncedFilters(club, 'account-a')).toBe(true);
  expect(loadFilters(club, 'account-a').HOLDEM?.games).toEqual([GAME_B]);
  pushRemoteFilters(club, newer);
  await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(1));
  expect(sent(state.writes[1], 'filters.HOLDEM').games).toEqual([GAME_B]);
  state.writes[1].resolve({ error: null });
  await settle();
  expect(hasUnsyncedFilters(club, 'account-a')).toBe(false);
});
