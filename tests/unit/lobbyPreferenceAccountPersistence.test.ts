import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writes: [] as Array<{ payload: any; resolve: (v: any) => void }>,
  server: null as any,
}));
/* fn_save_lobby_preferences (2026-11-05): each request waits for the test;
   a success is answered by the fake server under the database's rules. */
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, payload: any) =>
      new Promise((resolve) =>
        state.writes.push({
          payload,
          resolve: async () => {
            const { answer } = await import('../helpers/fakePreferenceServer');
            resolve({ data: answer(state.server, 'account-a', fn, payload), error: null });
          },
        })
      ),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import {
  loadViewPrefs,
  saveViewPrefs,
  pushRemoteViewPrefs,
} from '../../src/components/lobby/lobbyViewPrefs';
const plo = { tab: 'OMAHA' as const, sortByTab: {}, favoritesOnly: false };
const holdem = { ...plo, tab: 'HOLDEM' as const };
const tabSent = (w: { payload: any }) =>
  w.payload.p_changes.find((c: any) => c.field === 'view.tab')?.value;
beforeEach(async () => {
  const { createFakePreferenceServer } = await import('../helpers/fakePreferenceServer');
  state.server = createFakePreferenceServer();
  const { useUserStore } = await import('../../src/stores/useUserStore');
  useUserStore.setState({ user: { id: 'account-a' } as any });
  localStorage.clear();
  state.writes.length = 0;
});
it('keeps each account choice across sign-out and returning hours later', () => {
  saveViewPrefs('club', plo, 'account-a');
  saveViewPrefs('club', holdem, 'account-b');
  expect(loadViewPrefs('club', 'account-a').tab).toBe('OMAHA');
  expect(loadViewPrefs('club', 'account-b').tab).toBe('HOLDEM');
  expect(loadViewPrefs('club', 'new-account').tab).toBeNull();
});
it('adopts the legacy browser preference for one account only', () => {
  localStorage.setItem('ca_lobby_view_club', JSON.stringify(plo));
  expect(loadViewPrefs('club', 'account-a').tab).toBe('OMAHA');
  expect(loadViewPrefs('club', 'account-b').tab).toBeNull();
});
it('saves rapid changes in tap order even when the first network request is slow', async () => {
  pushRemoteViewPrefs('club', holdem, 'account-a');
  await vi.waitFor(() => expect(state.writes).toHaveLength(1));
  // The second tap lands while the first request is still slow in flight.
  pushRemoteViewPrefs('club', plo, 'account-a');
  expect(state.writes.map(tabSent)).toEqual(['HOLDEM']);
  state.writes[0].resolve({ error: null });
  await vi.waitFor(() => expect(state.writes).toHaveLength(2));
  expect(tabSent(state.writes[1])).toBe('OMAHA');
  state.writes[1].resolve({ error: null });
  await Promise.resolve();
});
