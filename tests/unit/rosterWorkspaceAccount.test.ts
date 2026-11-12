import { beforeEach, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  writes: [] as any[],
  fail: false,
  read: null as Promise<any> | null,
  revision: 0,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const terms: Record<string, string> = {};
        const query = {
          eq: (key: string, value: string) => {
            terms[key] = value;
            return query;
          },
          maybeSingle: () =>
            remote.read ??
            Promise.resolve({
              data: remote.rows.has(`${terms.user_id}/${terms.preference_key}`)
                ? { value: remote.rows.get(`${terms.user_id}/${terms.preference_key}`) }
                : null,
              error: null,
            }),
        };
        return query;
      },
    }),
    /* fn_save_page_preferences (2026-11-05): it acts for the signed-in
       account only, which is why each test below signs its viewer in first. */
    rpc: async (fn: string, args: any) => {
      const { useUserStore } = await import('../../src/stores/useUserStore');
      const user = useUserStore.getState().user?.id;
      const c = args.p_changes[0];
      const row = { user_id: user, preference_key: c.field, value: c.value };
      remote.writes.push(row);
      if (fn !== 'fn_save_page_preferences' || remote.fail)
        return { data: null, error: new Error('offline') };
      remote.rows.set(`${row.user_id}/${row.preference_key}`, row.value);
      remote.revision += 1;
      return {
        data: {
          ok: true,
          results: [
            { field: c.field, status: 'applied', revision: remote.revision, value: c.value },
          ],
        },
        error: null,
      };
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import {
  defaultRosterWorkspace,
  loadRosterWorkspace,
  readRosterWorkspace,
  writeRosterWorkspace,
} from '../../src/lib/rosterWorkspace';
import { readTableSettingIntent } from '../../src/lib/tableSettingIntents';
import { useUserStore } from '../../src/stores/useUserStore';
const signIn = (id: string) => useUserStore.setState({ user: { id } as any });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  remote.rows.clear();
  remote.writes = [];
  remote.fail = false;
  remote.read = null;
});
it('restores the complete account workspace on an empty second device without writing defaults or exposing another account', async () => {
  const workspace = {
    ...defaultRosterWorkspace(),
    search: 'Ada',
    filter: 'online' as const,
    sort: 'fees' as const,
    columns: ['fees'] as const,
  };
  const chosen = { ...workspace, columns: [...workspace.columns] };
  signIn('roster-a');
  expect(await loadRosterWorkspace('roster-a', 'club-x')).toEqual(defaultRosterWorkspace());
  writeRosterWorkspace('roster-a', 'club-x', defaultRosterWorkspace());
  expect(remote.writes).toHaveLength(0);
  writeRosterWorkspace('roster-a', 'club-x', chosen);
  await vi.waitFor(() =>
    expect(remote.rows.get('roster-a/roster:workspace:club-x')).toEqual({ ...chosen, version: 3 })
  );
  sessionStorage.clear();
  localStorage.clear();
  expect(await loadRosterWorkspace('roster-a', 'club-x')).toEqual(chosen);
  signIn('roster-b');
  expect(await loadRosterWorkspace('roster-b', 'club-x')).toEqual(defaultRosterWorkspace());
  signIn('roster-a');
  expect(await loadRosterWorkspace('roster-a', 'club-y')).toEqual(defaultRosterWorkspace());
  expect(remote.writes).toHaveLength(1);
});
it('retains the original failed account write through logout and restores it on that account only', async () => {
  const chosen = { ...defaultRosterWorkspace(), search: 'Pending', sort: 'wallet' as const };
  signIn('roster-c');
  await loadRosterWorkspace('roster-c', 'club-x');
  remote.fail = true;
  writeRosterWorkspace('roster-c', 'club-x', chosen);
  await vi.waitFor(() => expect(remote.writes).toHaveLength(1));
  expect(readTableSettingIntent('roster-c', 'page:roster:workspace:club-x')?.value).toEqual(chosen);
  // Another account signs in on this device: c's unsent workspace is neither
  // shown to it nor sent under it.
  signIn('roster-d');
  expect(await loadRosterWorkspace('roster-d', 'club-x')).toEqual(defaultRosterWorkspace());
  expect(remote.writes.every((w) => w.user_id === 'roster-c')).toBe(true);
  remote.fail = false;
  signIn('roster-c');
  expect(await loadRosterWorkspace('roster-c', 'club-x')).toEqual(chosen);
  await vi.waitFor(() =>
    expect(remote.rows.get('roster-c/roster:workspace:club-x')).toEqual({ ...chosen, version: 3 })
  );
  await vi.waitFor(() =>
    expect(readTableSettingIntent('roster-c', 'page:roster:workspace:club-x')).toBeNull()
  );
});
it('an older server workspace cannot replace a newer gesture while loading', async () => {
  let resolve!: (value: any) => void;
  remote.read = new Promise((done) => {
    resolve = done;
  });
  signIn('roster-e');
  const load = loadRosterWorkspace('roster-e', 'club-x');
  const chosen = { ...defaultRosterWorkspace(), search: 'Newest' };
  writeRosterWorkspace('roster-e', 'club-x', chosen);
  resolve({ data: { value: { ...defaultRosterWorkspace(), search: 'Old' } }, error: null });
  expect(await load).toEqual(chosen);
  expect(readRosterWorkspace('roster-e', 'club-x')).toEqual(chosen);
});
