/**
 * ===========================================================================
 *  LAW - A RENAMED CLUB'S OLD LINK KEEPS WORKING
 * ===========================================================================
 *
 * On 2026-11-14 The Felt Society's slug was changed in production from
 * club-jaqk to the-felt-society, and every /hub/club-arena/clubs/club-jaqk/...
 * link stopped resolving: ArenaAccessBoundary (in front of every club route)
 * answered "Arena Not Found", and the settings, rules, lobby and invite reads
 * filtered `.eq('slug', 'club-jaqk')` and found nothing.
 *
 * The rename is now recorded (club_slug_history, 20261114235606/235607) and
 * there is ONE place a route's club param becomes a club:
 *
 *   - src/utils/clubIdResolver.ts asks the clubs table first and the rename
 *     history second, and never caches a history answer, so a club that
 *     holds the slug now always wins over the club that held it before;
 *   - every `clubs` read keyed by a route param goes through it
 *     (resolveClubLookupFilter, resolveClubUUID, resolveClubUUIDStrict);
 *   - the arena entitlement is re-read by the same server function for the
 *     resolved id, so membership and authorization are the current slug's;
 *   - SlugEnforcer rewrites /clubs/<former>/<rest>?<query>#<hash> to the
 *     current slug, so a shared link corrects itself.
 *
 * Each pin below fails silently if it regresses: the old link would show
 * "Arena Not Found" or an empty page again, or a slug answer would outlive a
 * rename and open the wrong club.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FELT = 'a0000000-0000-0000-0000-000000000001';
const OTHER = 'b0000000-0000-0000-0000-000000000002';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  clubs: [] as Row[],
  history: [] as Row[],
  historyError: null as { message: string; code?: string } | null,
  reads: [] as string[],
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  arena: (_key: string): unknown => null,
  reported: [] as string[],
  session: { user: { id: 'signed-in' } } as unknown,
}));

vi.mock('../src/utils/errorReporter', async (original) => ({
  ...(await original<typeof import('../src/utils/errorReporter')>()),
  reportError: (_error: unknown, where: string) => {
    db.reported.push(where);
  },
}));

vi.mock('../src/lib/supabase', () => {
  const table = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      abortSignal: () => chain,
      maybeSingle: async () => {
        db.reads.push(`${name}:${filters.map(([c, v]) => `${c}=${String(v)}`).join(',')}`);
        if (name === 'club_slug_history' && db.historyError)
          return { data: null, error: db.historyError };
        const rows = name === 'clubs' ? db.clubs : name === 'club_slug_history' ? db.history : [];
        const hit = rows.find((row) => filters.every(([c, v]) => row[c] === v)) ?? null;
        return { data: hit, error: null };
      },
    };
    return chain;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: db.session }, error: null }) },
      from: (name: string) => table(name),
      rpc: (fn: string, args: Record<string, unknown>) => {
        db.rpcs.push({ fn, args });
        const response = Promise.resolve({ data: db.arena(String(args.p_club_key)), error: null });
        return Object.assign(response, { abortSignal: () => response });
      },
    },
  };
});

import {
  clearClubUUIDCache,
  CLUB_UUID_MAP_KEY,
  currentSlugForFormerClubSlug,
  resolveClubUUID,
} from '../src/utils/clubIdResolver';
import { resolveClubLookupFilter } from '../src/utils/clubLookupFilter';
import {
  ClubNotFoundError,
  ClubResolutionError,
  resolveClubUUIDStrict,
} from '../src/utils/strictClubIdResolver';
import { getArenaContext } from '../src/services/ArenaContextService';
import SlugEnforcer from '../src/components/common/SlugEnforcer';

const ROOT = resolve(__dirname, '..');
const src = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function renamed() {
  db.clubs = [{ id: FELT, slug: 'the-felt-society', club_id: 77777 }];
  db.history = [{ former_slug: 'club-jaqk', club_id: FELT }];
}

beforeEach(() => {
  db.clubs = [];
  db.history = [];
  db.historyError = null;
  db.reads = [];
  db.rpcs = [];
  db.arena = () => null;
  db.reported = [];
  db.session = { user: { id: 'signed-in' } };
  clearClubUUIDCache();
  localStorage.clear();
});

describe('a former slug resolves through the one resolver', () => {
  it('the current slug and the former slug name the same club', async () => {
    renamed();
    await expect(resolveClubUUID('the-felt-society')).resolves.toBe(FELT);
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe(FELT);
    await expect(resolveClubUUIDStrict('club-jaqk')).resolves.toBe(FELT);
    await expect(resolveClubLookupFilter('club-jaqk')).resolves.toEqual({
      column: 'id',
      value: FELT,
    });
    // The clubs table is always asked before the history.
    expect(db.reads.indexOf('clubs:slug=club-jaqk')).toBeLessThan(
      db.reads.indexOf('club_slug_history:former_slug=club-jaqk')
    );
  });

  it('a club that takes a freed slug wins, even after the old answer was seen', async () => {
    renamed();
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe(FELT);
    // Another club is given club-jaqk later (the history row is left behind
    // on purpose: an INSERT of a new club is not a rename).
    db.clubs.push({ id: OTHER, slug: 'club-jaqk', club_id: 123456 });
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe(OTHER);
    await expect(resolveClubUUIDStrict('club-jaqk')).resolves.toBe(OTHER);
    await expect(resolveClubLookupFilter('club-jaqk')).resolves.toEqual({
      column: 'id',
      value: OTHER,
    });
    await expect(currentSlugForFormerClubSlug('club-jaqk')).resolves.toBeNull();
  });

  it('only the immutable six-digit code is persisted across sessions', async () => {
    renamed();
    await resolveClubUUID('the-felt-society');
    await resolveClubUUID('club-jaqk');
    await resolveClubUUID('77777');
    const persisted = JSON.parse(localStorage.getItem(CLUB_UUID_MAP_KEY) || '{}');
    expect(persisted).toEqual({ '77777': FELT });
    // A slug persisted by an older build is not trusted on the next load.
    clearClubUUIDCache();
    localStorage.setItem(CLUB_UUID_MAP_KEY, JSON.stringify({ 'club-jaqk': OTHER, '77777': FELT }));
    db.reads = [];
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe(FELT);
    expect(db.reads).toContain('clubs:slug=club-jaqk');
  });

  it('an unknown slug is not found, and a failed history read is never "not found"', async () => {
    renamed();
    await expect(resolveClubUUIDStrict('no-such-club')).rejects.toBeInstanceOf(ClubNotFoundError);
    await expect(resolveClubLookupFilter('no-such-club')).resolves.toEqual({
      column: 'slug',
      value: 'no-such-club',
    });
    db.historyError = { message: 'upstream connect error', code: 'PGRST000' };
    const error = await resolveClubUUIDStrict('club-jaqk').catch((caught) => caught);
    expect(error).toBeInstanceOf(ClubResolutionError);
    expect(error).not.toBeInstanceOf(ClubNotFoundError);
  });

  it('a signed-out visitor never asks the history, and nothing is reported', async () => {
    renamed();
    db.session = null;
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe('club-jaqk');
    await expect(resolveClubUUIDStrict('club-jaqk')).rejects.toBeInstanceOf(ClubNotFoundError);
    await expect(resolveClubLookupFilter('club-jaqk')).resolves.toEqual({
      column: 'slug',
      value: 'club-jaqk',
    });
    await expect(currentSlugForFormerClubSlug('club-jaqk')).resolves.toBeNull();
    expect(db.reads.some((read) => read.startsWith('club_slug_history:'))).toBe(false);
    expect(db.reported).toEqual([]);
    // The current slug still resolves for them: clubs is public.
    await expect(resolveClubUUID('the-felt-society')).resolves.toBe(FELT);
    // Signed in, the same old slug resolves.
    db.session = { user: { id: 'signed-in' } };
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe(FELT);
  });

  it('a session that lapses before the read is refused quietly too', async () => {
    renamed();
    // club_slug_history grants nothing to anon: PostgREST answers 42501.
    db.historyError = { message: 'permission denied for table club_slug_history', code: '42501' };
    await expect(resolveClubUUID('club-jaqk')).resolves.toBe('club-jaqk');
    await expect(resolveClubUUIDStrict('club-jaqk')).rejects.toBeInstanceOf(ClubNotFoundError);
    await expect(currentSlugForFormerClubSlug('club-jaqk')).resolves.toBeNull();
    expect(db.reported).toEqual([]);
    // Any other failure is still a fault somebody hears about.
    db.historyError = { message: 'upstream connect error', code: 'PGRST000' };
    await resolveClubUUID('club-jaqk');
    expect(db.reported).toEqual(['clubIdResolver.formerSlug']);
  });

  it('an id or a club code never asks the history', async () => {
    renamed();
    await expect(resolveClubLookupFilter(FELT)).resolves.toEqual({ column: 'id', value: FELT });
    await expect(resolveClubLookupFilter('77777')).resolves.toEqual({
      column: 'club_id',
      value: 77777,
    });
    expect(db.reads).toEqual([]);
  });
});

describe('the arena entitlement for an old link is the club it names, read by the server', () => {
  it('re-reads fn_poker_arena_context for the resolved id, and passes its answer through', async () => {
    renamed();
    // The server matches id, code and CURRENT slug only, as in production.
    db.arena = (key) =>
      key === FELT || key === 'the-felt-society'
        ? {
            arena: { id: FELT, asset: 'chips', is_platform: false, union_id: null },
            member: false,
            role: null,
          }
        : null;
    const context = await getArenaContext('club-jaqk');
    expect(db.rpcs.map((call) => call.args.p_club_key)).toEqual(['club-jaqk', FELT]);
    expect(context?.arena.id).toBe(FELT);
    // A viewer the server does not admit stays not admitted: no synthetic membership.
    expect(context?.member).toBe(false);
  });

  it('a current slug costs one server read and no history read', async () => {
    renamed();
    db.arena = (key) =>
      key === 'the-felt-society'
        ? {
            arena: { id: FELT, asset: 'chips', is_platform: false, union_id: null },
            member: true,
            role: 'owner',
          }
        : null;
    await expect(getArenaContext('the-felt-society')).resolves.toMatchObject({ member: true });
    expect(db.rpcs).toHaveLength(1);
    expect(db.reads).toEqual([]);
  });

  it('a slug nobody ever held is still "Arena Not Found"', async () => {
    renamed();
    await expect(getArenaContext('no-such-club')).resolves.toBeNull();
    expect(db.rpcs).toHaveLength(1);
  });
});

function Where() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}${location.hash}`}</output>;
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('an old link rewrites itself to the current slug', () => {
  it('keeps the nested path, the date filter and the fragment', async () => {
    renamed();
    render(
      <MemoryRouter
        initialEntries={['/clubs/club-jaqk/data?dataStart=2026-11-02&dataEnd=2026-11-09#week']}
      >
        <SlugEnforcer />
        <Where />
      </MemoryRouter>
    );
    await settle();
    expect(screen.getByRole('status').textContent).toBe(
      '/clubs/the-felt-society/data?dataStart=2026-11-02&dataEnd=2026-11-09#week'
    );
  });

  it('leaves an old link alone for a signed-out visitor (it rewrites after sign-in)', async () => {
    renamed();
    db.session = null;
    render(
      <MemoryRouter initialEntries={['/clubs/club-jaqk/data?dataStart=2026-11-02']}>
        <SlugEnforcer />
        <Where />
      </MemoryRouter>
    );
    await settle();
    expect(screen.getByRole('status').textContent).toBe(
      '/clubs/club-jaqk/data?dataStart=2026-11-02'
    );
    expect(db.reported).toEqual([]);
  });

  it('leaves a current slug where it is', async () => {
    renamed();
    render(
      <MemoryRouter initialEntries={['/clubs/the-felt-society/data?dataStart=2026-11-02']}>
        <SlugEnforcer />
        <Where />
      </MemoryRouter>
    );
    await settle();
    expect(screen.getByRole('status').textContent).toBe(
      '/clubs/the-felt-society/data?dataStart=2026-11-02'
    );
  });
});

describe('every consumer that turns a club param into a club uses the resolver', () => {
  const files = sourceFiles(join(ROOT, 'src')).map((path) => relative(ROOT, path));

  it('resolveClubIdFilter is called only inside the resolver modules', () => {
    const callers = files.filter((path) => /\bresolveClubIdFilter\(/.test(src(path)));
    expect(callers.sort()).toEqual(
      [
        'src/utils/clubIdResolver.ts',
        'src/utils/clubLookupFilter.ts',
        'src/utils/strictClubIdResolver.ts',
      ].sort()
    );
  });

  it('no club is read by a raw slug filter', () => {
    const rawSlugReads = files.filter(
      (path) => path !== 'src/utils/unionIdResolver.ts' && /\.eq\(\s*['"]slug['"]/.test(src(path))
    );
    expect(rawSlugReads).toEqual([]);
  });

  it('the route consumers read through resolveClubLookupFilter', () => {
    for (const path of [
      'src/pages/ClubHomePage.tsx',
      'src/pages/ClubSettingsPage.tsx',
      'src/pages/ClubRulesPage.tsx',
      'src/pages/InvitePage.tsx',
      'src/components/agent/ChipTransferModal.tsx',
    ]) {
      expect(src(path), path).toMatch(/await resolveClubLookupFilter\(/);
    }
  });

  it('the strict resolver, the arena check and the redirect read the same history', () => {
    expect(src('src/utils/strictClubIdResolver.ts')).toContain(
      'formerClubId = await readFormerSlugClubId(clubIdParam, signal);'
    );
    expect(src('src/services/ArenaContextService.ts')).toContain(
      'const clubUUID = await resolveClubUUID(key);'
    );
    expect(src('src/components/common/SlugEnforcer.tsx')).toContain(
      'resolver.currentSlugForFormerClubSlug(segment)'
    );
  });
});
