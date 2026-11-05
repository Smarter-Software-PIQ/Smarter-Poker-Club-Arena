/**
 * An in-memory stand-in for the preference functions of migration
 * 20261105183133, with the SAME rules: a change applies only against its
 * field's current revision (null base: only a never-saved field), a refused
 * change answers CONFLICT with the account's current value, an unfavorite is
 * kept with its revision, and every call acts for one account only.
 *
 * The native proof (scripts/dev/test-lobby-favorites-postgres.sh) checks the
 * real SQL; this lets the application tests exercise the client against the
 * same answers without a database.
 */
type Change = { field: string; value?: unknown; base?: number | null };
type FavChange = { kind: string; game_id: string; on: boolean; base?: number | null };

export interface FakePreferenceServer {
  revision: number;
  /** user -> club -> { filters, view_prefs, revisions } */
  lobby: Map<
    string,
    Map<
      string,
      {
        filters: Record<string, unknown>;
        view_prefs: Record<string, any>;
        revisions: Record<string, number>;
      }
    >
  >;
  /** user -> key -> { value, revision } */
  page: Map<string, Map<string, { value: unknown; revision: number }>>;
  /** user -> field ("kind:game") -> { active, revision } */
  favorites: Map<string, Map<string, { active: boolean; revision: number }>>;
  calls: { fn: string; user: string; args: any }[];
}

export function createFakePreferenceServer(): FakePreferenceServer {
  return { revision: 100, lobby: new Map(), page: new Map(), favorites: new Map(), calls: [] };
}

function stale(base: number | null | undefined, current: number): boolean {
  const b = typeof base === 'number' ? base : null;
  return (b === null && current > 0) || (b !== null && b < current);
}

function lobbyRow(server: FakePreferenceServer, user: string, club: string) {
  if (!server.lobby.has(user)) server.lobby.set(user, new Map());
  const rows = server.lobby.get(user)!;
  if (!rows.has(club)) rows.set(club, { filters: {}, view_prefs: {}, revisions: {} });
  return rows.get(club)!;
}

function readField(row: ReturnType<typeof lobbyRow>, field: string): unknown {
  if (field.startsWith('filters.')) return row.filters[field.slice(8)] ?? null;
  if (field === 'view.tab') return row.view_prefs.tab ?? null;
  if (field === 'view.favoritesOnly') return row.view_prefs.favoritesOnly ?? null;
  return row.view_prefs.sortByTab?.[field.slice(10)] ?? null;
}

function writeField(row: ReturnType<typeof lobbyRow>, field: string, value: unknown): void {
  if (field.startsWith('filters.')) row.filters[field.slice(8)] = value;
  else if (field === 'view.tab') row.view_prefs.tab = value;
  else if (field === 'view.favoritesOnly') row.view_prefs.favoritesOnly = value;
  else {
    row.view_prefs.sortByTab = { ...(row.view_prefs.sortByTab ?? {}) };
    row.view_prefs.sortByTab[field.slice(10)] = value;
  }
}

/** Answer one call as the database would, for `user`. */
export function answer(server: FakePreferenceServer, user: string, fn: string, args: any): any {
  server.calls.push({ fn, user, args });
  if (fn === 'fn_save_lobby_preferences') {
    const row = lobbyRow(server, user, args.p_club_id);
    const results = (args.p_changes as Change[]).map((c) => {
      const current = row.revisions[c.field] ?? 0;
      if (stale(c.base, current)) {
        return {
          field: c.field,
          status: 'conflict',
          revision: current,
          value: readField(row, c.field),
        };
      }
      server.revision += 1;
      writeField(row, c.field, c.value ?? null);
      row.revisions[c.field] = server.revision;
      return {
        field: c.field,
        status: 'applied',
        revision: server.revision,
        value: readField(row, c.field),
      };
    });
    return {
      ok: true,
      results,
      filters: row.filters,
      view_prefs: row.view_prefs,
      revisions: row.revisions,
    };
  }
  if (fn === 'fn_save_page_preferences') {
    if (!server.page.has(user)) server.page.set(user, new Map());
    const rows = server.page.get(user)!;
    const results = (args.p_changes as Change[]).map((c) => {
      const row = rows.get(c.field);
      const current = row?.revision ?? 0;
      if (stale(c.base, current))
        return { field: c.field, status: 'conflict', revision: current, value: row?.value };
      server.revision += 1;
      rows.set(c.field, { value: c.value, revision: server.revision });
      return { field: c.field, status: 'applied', revision: server.revision, value: c.value };
    });
    return { ok: true, results };
  }
  if (fn === 'fn_set_lobby_favorites') {
    if (!server.favorites.has(user)) server.favorites.set(user, new Map());
    const rows = server.favorites.get(user)!;
    const results = (args.p_changes as FavChange[]).map((c) => {
      const field = `${c.kind}:${c.game_id}`;
      const row = rows.get(field);
      const current = row?.revision ?? 0;
      if (stale(c.base, current)) {
        return { field, status: 'conflict', revision: current, active: row?.active ?? false };
      }
      server.revision += 1;
      rows.set(field, { active: c.on, revision: server.revision });
      return { field, status: 'applied', revision: server.revision, active: c.on };
    });
    return { ok: true, results };
  }
  if (fn === 'fn_my_lobby_favorites') {
    return [...(server.favorites.get(user) ?? new Map()).entries()].map(([field, row]) => ({
      kind: field.slice(0, field.indexOf(':')),
      game_id: field.slice(field.indexOf(':') + 1),
      game_key: field,
      active: row.active,
      revision: row.revision,
    }));
  }
  throw new Error(`fake preference server: unknown function ${fn}`);
}

/** Read what the account holds for a lobby row, as a select would. */
export function lobbySelect(server: FakePreferenceServer, user: string, club: string) {
  const row = server.lobby.get(user)?.get(club);
  return row
    ? { filters: row.filters, view_prefs: row.view_prefs, revisions: row.revisions }
    : null;
}

export function pageSelect(server: FakePreferenceServer, user: string, key: string) {
  const row = server.page.get(user)?.get(key);
  return row ? { value: row.value, revision: row.revision } : null;
}
