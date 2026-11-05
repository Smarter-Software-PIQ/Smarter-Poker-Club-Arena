/**
 * LOBBY FAVORITES AND FILTERS NEVER FORGET THEMSELVES (Dan 2026-11-05)
 *
 * "ONCE SET, IT CAN NEVER EVER EVER CHANGE UNDER ANY CIRCUMSTANCES UNLESS THE
 * USER PHYSICALLY GOES IN AND CHANGES IT OR 'UN FAVORITES' A CASH GAME OR
 * TOURNAMENT."
 *
 * Three root causes, each pinned so it cannot return:
 *   1. Tournament stars were stored against one RUN's id, and every scheduled
 *      event creates a new row per run, so yesterday's star never reached
 *      tonight's run. Stars now belong to the schedule / named series.
 *   2. Cash stars were favorite_tables rows with ON DELETE CASCADE to tables,
 *      so a rebuilt table dropped them. Stars now live in
 *      player_lobby_favorites with NO foreign key to any game row, and a guard
 *      trigger refuses every removal but the player's own unfavorite.
 *   3. Filters and the tab/sort/Favorites view resolved their owner from the
 *      access token, which reads as "signed out" once the hour-long token has
 *      expired, so taps in that window were saved under the signed-out key and
 *      never reached the row. The owner is now the signed-in account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  writes: [] as Array<{ payload: any }>,
  storeUser: { id: 'account-a' } as { id: string } | null,
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (payload: unknown) => {
        state.writes.push({ payload });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));
// The access token has EXPIRED: the strict read says "nobody is signed in".
vi.mock('../src/lib/authUtils', () => ({
  readLocalSession: (opts?: { allowExpired?: boolean }) =>
    opts?.allowExpired ? { userId: 'account-a' } : null,
}));
vi.mock('../src/stores/useUserStore', () => ({
  useUserStore: { getState: () => ({ user: state.storeUser }) },
}));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { loadFilters, persistFilters } from '../src/components/lobby/AdvancedFilters';
import { pushRemoteViewPrefs } from '../src/components/lobby/lobbyViewPrefs';
import { FILTER_SPECS, emptyFilterValue } from '../src/components/lobby/advancedFilterSpec';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 0));

function favoritesMigration(): string {
  const dir = join(root, 'supabase/migrations');
  const file = readdirSync(dir).find((f) =>
    f.endsWith('_lobby_favorites_follow_the_game_not_the_row.sql')
  );
  expect(file, 'the favorites migration exists').toBeTruthy();
  return readFileSync(join(dir, file!), 'utf8');
}

describe('a favorite belongs to the game, not one table or run', () => {
  it('the lobby never stores a star against a single table or tournament run', () => {
    const page = read('src/pages/ClubHomePage.tsx');
    expect(page).not.toMatch(/lobby-tournament-favorites/);
    expect(page).not.toMatch(/from\('favorite_tables'\)/);
    expect(page).toMatch(/fetchLobbyFavorites\(\)/);
    expect(page).toMatch(/setLobbyFavorite\(favKind, gameId, next\)/);
    expect(read('src/components/quickactions/favoriteTables.ts')).not.toMatch(
      /from\('favorite_tables'\)/
    );
  });

  it('a failed read never wipes the stars on screen', () => {
    const page = read('src/pages/ClubHomePage.tsx');
    expect(page).toMatch(/if \(favsRes\.ok\) setFavoriteGameIds\(new Set\(favsRes\.ids\)\)/);
  });

  it('the store has no foreign key to tables or tournaments and refuses any removal but the player', () => {
    const sql = favoritesMigration();
    const table = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.player_lobby_favorites'),
      sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS public.player_lobby_favorites'))
    );
    expect(table).not.toMatch(/REFERENCES\s+public\.(tables|tournaments)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.player_lobby_favorites/);
    expect(sql).toMatch(/BEFORE TRUNCATE ON public\.player_lobby_favorites/);
    expect(sql).toMatch(/removed only by the player''s own unfavorite/);
    // Authenticated users cannot write the table directly; only the RPC can.
    expect(sql).toMatch(
      /REVOKE ALL ON public\.player_lobby_favorites FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*player_lobby_favorites/i);
  });

  it('a scheduled tournament is starred by its schedule, so every run inherits it', () => {
    const sql = favoritesMigration();
    expect(sql).toMatch(/'schedule:' \|\| t\.schedule_id::text/);
    expect(sql).toMatch(/t\.schedule_id = substr\(f\.game_key, 10\)::uuid/);
    expect(sql).toMatch(/'cash:' \|\| coalesce\(tb\.club_id::text, ''\)/);
  });

  it('every existing star is carried forward', () => {
    const sql = favoritesMigration();
    expect(sql).toMatch(/FROM public\.favorite_tables ft/);
    expect(sql).toMatch(/preference_key LIKE 'lobby-tournament-favorites%'/);
  });
});

describe('a filter belongs to the signed-in player even after the token expires', () => {
  beforeEach(() => {
    localStorage.clear();
    state.writes.length = 0;
    state.storeUser = { id: 'account-a' };
  });

  it('a filter tapped with an expired token is saved to the account and sent to the row', async () => {
    const store = { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), seatMax: 6 } };
    persistFilters('club-x', store);
    await settle();
    expect(localStorage.getItem('ca_advanced_filters_account-a:club-x')).not.toBeNull();
    expect(localStorage.getItem('ca_advanced_filters_club-x')).toBeNull();
    expect(state.writes.some((w) => w.payload?.user_id === 'account-a')).toBe(true);
    expect(loadFilters('club-x').HOLDEM?.seatMax).toBe(6);
  });

  it('the tab, sort and Favorites chip reach the row with an expired token', async () => {
    pushRemoteViewPrefs('club-y', { tab: 'OMAHA', sortByTab: {}, favoritesOnly: true });
    await settle();
    expect(state.writes.some((w) => w.payload?.user_id === 'account-a')).toBe(true);
  });

  it('owner resolution prefers the signed-in account over the token', () => {
    for (const p of [
      'src/components/lobby/AdvancedFilters.tsx',
      'src/components/lobby/lobbyViewPrefs.ts',
    ]) {
      const src = read(p);
      const fn = src.slice(src.indexOf('function currentUserId()'));
      expect(fn.indexOf('useUserStore.getState()')).toBeGreaterThan(-1);
      expect(fn.indexOf('useUserStore.getState()')).toBeLessThan(fn.indexOf('readLocalSession('));
    }
  });
});
