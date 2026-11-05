/**
 * LOBBY FAVORITES AND FILTERS ARE DURABLE ACCOUNT PREFERENCES (Dan 2026-11-05)
 *
 * "favorites and filters are durable account preferences whose saved values
 * change only through the account owner's explicit action or authorized
 * account deletion."
 *
 * The root causes, each pinned so it cannot return:
 *   1. Stars were stored against one tournament RUN or one cash TABLE, so the
 *      next run or a rebuilt table came up unstarred. A favorite now follows
 *      the logical game (schedule, engine board, satellite event, cash game).
 *   2. Every save upserted the whole filter / view snapshot, so a stale copy
 *      overwrote newer choices and untouched settings. Only changed fields are
 *      sent now, each against a server-held revision; stale ones are refused.
 *   3. Filter ownership was read from the access token, which reads "signed
 *      out" once it expires. It is the signed-in account now.
 *   4. Anything could write the rows. Only the owner's functions can now, and
 *      only account deletion removes them.
 * The native proof scripts/dev/test-lobby-favorites-postgres.sh checks the SQL
 * itself (run in CI by lobby-favorites-are-durable.yml).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sliceSqlStatement } from './helpers/sourceWindow';
import { SPIN_SPEED_LABELS } from '../server/src/config/spinSpec';
import { HEADS_UP_BUYINS, HEADS_UP_GAME_TYPES } from '../server/src/config/headsUpSpec';

const state = vi.hoisted(() => ({ calls: [] as { fn: string; args: any }[], server: null as any }));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: any) => {
      state.calls.push({ fn, args });
      const { answer } = await import('./helpers/fakePreferenceServer');
      return { data: answer(state.server, 'account-a', fn, args), error: null };
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'account-a' } } }, error: null }),
    },
  },
}));
// The access token has EXPIRED: the strict read says "nobody is signed in".
vi.mock('../src/lib/authUtils', () => ({
  readLocalSession: (opts?: { allowExpired?: boolean }) =>
    opts?.allowExpired ? { userId: 'account-a' } : null,
}));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { loadFilters, persistFilters } from '../src/components/lobby/AdvancedFilters';
import { pushRemoteViewPrefs, loadViewPrefs } from '../src/components/lobby/lobbyViewPrefs';
import { FILTER_SPECS, emptyFilterValue } from '../src/components/lobby/advancedFilterSpec';
import { useUserStore } from '../src/stores/useUserStore';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function migration(): string {
  const dir = join(root, 'supabase/migrations');
  const file = readdirSync(dir).find((f) =>
    f.endsWith('_lobby_favorites_follow_the_game_not_the_row.sql')
  );
  expect(file, 'the favorites migration exists').toBeTruthy();
  return readFileSync(join(dir, file!), 'utf8');
}

describe('a favorite follows the logical game', () => {
  it('the lobby never stores a star against one table or one run', () => {
    const page = read('src/pages/ClubHomePage.tsx');
    expect(page).not.toMatch(/lobby-tournament-favorites/);
    expect(page).not.toMatch(/from\('favorite_tables'\)/);
    expect(page).toMatch(/fetchLobbyFavorites\(\)/);
    expect(page).toMatch(/toggleLobbyFavorite\(/);
    expect(read('src/components/quickactions/favoriteTables.ts')).not.toMatch(
      /from\('favorite_tables'\)/
    );
  });

  it('a failed read never wipes the stars on screen, and an unsent tap stays shown', () => {
    const page = read('src/pages/ClubHomePage.tsx');
    expect(page).toMatch(/if \(favsRes\.ok\) \{/);
    expect(page).toMatch(/pendingFavoriteStates\(currentUserId\)/);
  });

  it('identity never comes from a display name, except the engine board key', () => {
    const sql = migration();
    const keyFn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_lobby_tournament_key'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_lobby_cash_key')
    );
    expect(keyFn).toMatch(/'schedule:' \|\| t\.schedule_id::text/);
    // A satellite: the event it feeds and its format, never its name.
    const satellite = keyFn.slice(keyFn.indexOf("'satellite:'"), keyFn.indexOf("'board:'"));
    expect(satellite).not.toMatch(/\.name\b/);
    // Engine boards only (their catalogue format), scoped by club and union.
    expect(keyFn).toMatch(/IN \('sng-v1', 'spin-v1'\) THEN/);
    expect(keyFn).toMatch(
      /'board:' \|\| coalesce\(t\.club_id::text, ''\) \|\| ':' \|\| coalesce\(t\.union_id::text, ''\)/
    );
    const cashFn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_lobby_cash_key'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_lobby_favorite_key')
    );
    expect(cashFn).toMatch(/'cash_game:' \|\| tb\.cluster_id::text/);
    expect(cashFn).not.toMatch(/\.name\b/);
    // Recreated games inherit only through an explicit alias.
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.lobby_game_aliases/);
    expect(sql).toMatch(/public\.fn_lobby_current_key\(pf\.game_key\)/);
  });

  it('an engine board is never renamed without an alias', () => {
    /* A Sit N Go or Spin board's identity is its generated name within one
       owner scope, because that is how the engine itself keeps the board.
       If this fails you changed a board name: add lobby_game_aliases rows
       mapping each old 'board:<club>:<union>:<TYPE>:<old name>' to its new
       name in the same change, then update these pins. */
    const service = read('server/src/services/TournamentRecurringService.ts');
    expect(service).toContain(
      "name: `${v.label} ${shape.label} ${buyIn}${shape.turbo ? ' Turbo' : ''}`,"
    );
    expect(service).toContain('? `${buyIn} Chip Spin ${v.label}`');
    expect(service).toContain(': `${buyIn} Chip ${SPIN_SPEED_LABELS[speed]} Spin ${v.label}`,');
    expect(service).toContain("{ seats: HEADS_UP_SEATS, label: 'Heads-Up', turbo: false");
    expect(service).toContain("{ seats: HEADS_UP_SEATS, label: 'Heads-Up', turbo: true");
    expect(service).toContain('const SPIN_BOARD_BUYINS = [1, 2, 3, 5, 10, 20, 50, 100];');
    expect(service).toContain("const SPIN_BOARD_SPEEDS: SpinSpeed[] = ['turbo', 'deep'];");
    for (const v of ['NLH', 'PLO4', 'PLO5', 'PLO6']) {
      expect(service).toContain(`{ key: '${v.toLowerCase()}', label: '${v}' }`);
    }
    expect(SPIN_SPEED_LABELS).toEqual({ turbo: 'Turbo', deep: 'Deep Stack' });
    expect([...HEADS_UP_GAME_TYPES]).toEqual(['nlh', 'plo4']);
    expect([...HEADS_UP_BUYINS]).toEqual([1, 2, 5, 10, 20, 25, 50, 100]);
  });

  it('the store has no foreign key to any game row, and an unfavorite is kept', () => {
    const sql = migration();
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.player_lobby_favorites');
    const table = sql.slice(start, sql.indexOf(');', start));
    expect(table).not.toMatch(/REFERENCES\s+public\.(tables|tournaments|cash_games)/i);
    expect(table).toMatch(/active\s+boolean/);
    expect(table).toMatch(/revision\s+bigint/);
  });

  it('every legacy favorite is accounted for and its source left untouched', () => {
    const sql = migration();
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.lobby_favorites_migration_report/);
    expect(sql).toMatch(/outcome IN \('mapped', 'duplicate', 'unresolved'\)/);
    expect(sql).not.toMatch(/(DELETE FROM|UPDATE|TRUNCATE)\s+public\.favorite_tables/i);
    expect(sql).not.toMatch(/(DELETE FROM|TRUNCATE)\s+public\.user_page_preferences/i);
  });
});

describe('stale state never replaces newer accepted state', () => {
  it('every save states the revision it was made against, and the server checks it', () => {
    const sql = migration();
    for (const fn of [
      'fn_save_lobby_preferences',
      'fn_save_page_preferences',
      'fn_set_lobby_favorites',
    ]) {
      const body = sliceSqlStatement(sql, `CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(body).toMatch(
        /\(v_base IS NULL AND v_cur > 0\) OR \(v_base IS NOT NULL AND v_base < v_cur\)/
      );
    }
    expect(sql).toMatch(/nextval\('public\.player_preference_revision_seq'\)/);
    // No device clock anywhere in the decision.
    expect(sql).not.toMatch(/changed_at/);
  });

  it('only fields the player changed are sent, never a whole snapshot', () => {
    for (const p of [
      'src/components/lobby/AdvancedFilters.tsx',
      'src/components/lobby/lobbyViewPrefs.ts',
    ]) {
      expect(read(p)).not.toMatch(/\.upsert\(/);
    }
    for (const p of ['src/hooks/usePlayerPreference.ts', 'src/lib/rosterWorkspace.ts']) {
      expect(read(p)).not.toMatch(/\.upsert\(/);
      expect(read(p)).toMatch(/savePagePreference\(/);
    }
  });
});

describe('only the owner changes a saved value', () => {
  it('browsers can only read the stores; every write is the owner functions', () => {
    const sql = migration();
    expect(sql).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.user_lobby_filters FROM anon, authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.user_page_preferences FROM anon, authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON public\.player_lobby_favorites FROM PUBLIC, anon, authenticated, service_role;/
    );
    for (const table of ['player_lobby_favorites', 'user_lobby_filters', 'user_page_preferences']) {
      expect(sql).toMatch(
        new RegExp(
          `BEFORE INSERT OR UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.fn_player_preference_guard\\(\\)`
        )
      );
      expect(sql).toMatch(new RegExp(`BEFORE TRUNCATE ON public\\.${table}`));
    }
    // A delete only when the account itself is gone: no caller-supplied shortcut.
    expect(sql).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM auth\.users u WHERE u\.id = OLD\.user_id\) THEN RETURN OLD; END IF;/
    );
  });

  it('a queued change is sent only for the account that made it', () => {
    const sync = read('src/lib/preferenceSync.ts');
    expect(sync).toMatch(
      /if \(useUserStore\.getState\(\)\.user\?\.id !== owner\) return \{ ok: false, reason: 'not_owner' \};/
    );
    expect(sync).toMatch(
      /if \(live && live !== owner\) return \{ ok: false, reason: 'not_owner' \};/
    );
    // An expired session is renewed once, and only the same owner may retry.
    expect(sync).toMatch(/supabase\.auth\.refreshSession\(\)/);
    expect(sync).toMatch(
      /if \(id === owner && useUserStore\.getState\(\)\.user\?\.id === owner\) continue;/
    );
  });

  it('a native database proof of every guarantee ships and runs in CI', () => {
    // The script's check names are SQL strings, so an apostrophe is doubled there.
    const script = read('scripts/dev/test-lobby-favorites-postgres.sh').replace(/''/g, "'");
    for (const claim of [
      'editing the schedule and renaming the cash game keep both stars',
      'a different schedule with the same name and settings stays separate',
      "the board's next game inherits the star, even after its stack was edited",
      "a club's own one-off reusing the board's exact name and settings does not inherit",
      'with its alias, the renamed board keeps the star',
      'a new cash game reusing the old name does not inherit',
      'an older offline star is refused after the unfavorite, and the reply says it is unstarred',
      'a duplicate retry changes nothing and reports the already-saved value',
      'an older filter snapshot is refused and the reply carries the newer value',
      'a change sent under account B lands only on account B',
      'service paths cannot rewrite, delete, truncate or save on behalf of a player',
      "deleting the account removes its preferences and nobody else's",
    ]) {
      expect(script).toContain(claim);
    }
    expect(read('.github/workflows/lobby-favorites-are-durable.yml')).toContain(
      'bash scripts/dev/test-lobby-favorites-postgres.sh'
    );
  });
});

describe('a filter belongs to the signed-in player even after the token expires', () => {
  beforeEach(async () => {
    localStorage.clear();
    state.calls.length = 0;
    const { createFakePreferenceServer } = await import('./helpers/fakePreferenceServer');
    state.server = createFakePreferenceServer();
    useUserStore.setState({ user: { id: 'account-a' } as any });
  });

  it('a filter tapped with an expired token is saved to the account and sent', async () => {
    loadFilters('club-x');
    persistFilters('club-x', { HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), seatMax: 6 } });
    await vi.waitFor(() => expect(state.calls.length).toBe(1));
    expect(localStorage.getItem('ca_advanced_filters_account-a:club-x')).not.toBeNull();
    expect(localStorage.getItem('ca_advanced_filters_club-x')).toBeNull();
    expect(state.calls[0].fn).toBe('fn_save_lobby_preferences');
    expect(state.calls[0].args.p_changes.map((c: any) => c.field)).toEqual(['filters.HOLDEM']);
    expect(loadFilters('club-x').HOLDEM?.seatMax).toBe(6);
  });

  it('the tab, sort and Favorites chip are sent with an expired token', async () => {
    loadViewPrefs('club-y');
    pushRemoteViewPrefs('club-y', { tab: 'OMAHA', sortByTab: {}, favoritesOnly: true });
    await vi.waitFor(() => expect(state.calls.length).toBe(1));
    expect(state.calls[0].args.p_changes.map((c: any) => c.field).sort()).toEqual([
      'view.favoritesOnly',
      'view.tab',
    ]);
  });

  it('a saved value this build cannot show survives every save', async () => {
    localStorage.setItem(
      'ca_advanced_filters_account-a:club-z',
      JSON.stringify({
        HOLDEM: { ...emptyFilterValue(FILTER_SPECS.HOLDEM), seatMax: 6 },
        FUTURE_GAME: { anything: true },
      })
    );
    const shown = loadFilters('club-z');
    persistFilters('club-z', { ...shown, HOLDEM: { ...shown.HOLDEM!, seatMax: 9 } });
    await vi.waitFor(() => expect(state.calls.length).toBe(1));
    // Only Hold'em was changed, so only Hold'em was sent: the future game's
    // saved value is never touched, on the account or on this device.
    expect(state.calls[0].args.p_changes.map((c: any) => c.field)).toEqual(['filters.HOLDEM']);
    expect(
      JSON.parse(localStorage.getItem('ca_advanced_filters_account-a:club-z')!).FUTURE_GAME
    ).toEqual({ anything: true });
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

  it('switching to cash games never rewrites the saved status filter', () => {
    const page = read('src/pages/ClubHomePage.tsx');
    const toggle = page.slice(page.indexOf('onToggle={(section) => {'));
    expect(toggle.slice(0, toggle.indexOf('}}'))).not.toMatch(/setAllStatusFilter\(/);
    expect(page).toMatch(/const cashStatusFilter: AllStatusFilter =/);
  });
});
