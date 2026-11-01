/**
 * /hub/club-arena/unions/demo (2026-10-31, client_error_events): `invalid input
 * syntax for type uuid: "demo"` from ArenaSectionRail.union_overseer_authority,
 * ArenaSectionRail.union_game_authority and UnionDetailPage.onlineCount.
 *
 * The 'demo' link came from the production route E2E
 * (tests/e2e/routes/clubs.spec.ts visited `unions/demo` on every deploy). It
 * now opens a real union taken from the directory. And whatever the source,
 * an unresolvable union param renders Union Not Found WITHOUT calling any
 * UUID-keyed read (the rail half is pinned in
 * tests/unit/arenaSectionRailUnionAuthority.test.tsx).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  resolveUnionUUID: vi.fn(async (ref: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) ? ref : null
  ),
  uuidRead: vi.fn(async () => {
    throw new Error('a UUID-keyed read ran for an unresolved union');
  }),
}));

vi.mock('../../src/utils/unionIdResolver', () => ({
  resolveUnionUUID: m.resolveUnionUUID,
  resolveUnionUUIDSync: (ref: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) ? ref : null,
  unionRouteRef: (id: string) => id,
  rememberUnionSlug: vi.fn(),
  clearUnionUUIDCache: vi.fn(),
}));
vi.mock('../../src/services/UnionService', () => ({
  unionService: new Proxy({}, { get: () => m.uuidRead }),
}));
vi.mock('../../src/services/UnionApiService', () => ({
  unionApi: new Proxy({}, { get: () => m.uuidRead }),
}));
vi.mock('../../src/services/TableService', () => ({
  tableService: new Proxy({}, { get: () => m.uuidRead }),
}));
vi.mock('../../src/services/ClubsService', () => ({
  getUserMemberships: vi.fn(async () => []),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useOptionalToast: () => null,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('a direct table read ran for an unresolved union');
    },
    rpc: m.uuidRead,
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
  captureClientError: vi.fn(),
}));

import UnionDetailPage from '../../src/pages/UnionDetailPage';
import { reportError } from '../../src/utils/errorReporter';

describe('a demo union link renders not-found without UUID reads', () => {
  it.each(['demo', 'nonexistent-union', 'DROP TABLE'])('/unions/%s', async (ref) => {
    render(
      <MemoryRouter initialEntries={[`/unions/${encodeURIComponent(ref)}`]}>
        <Routes>
          <Route path="/unions/:unionId" element={<UnionDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText('Union Not Found')).toBeInTheDocument();
    expect(m.uuidRead).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('no route spec or source links to unions/demo', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'node_modules') walk(path);
        } else if (
          /\.(tsx?|jsx?|mjs)$/.test(name) &&
          !path.endsWith('aDemoUnionLinkRendersNotFound.test.tsx')
        ) {
          if (/unions\/demo\b/.test(readFileSync(path, 'utf8'))) offenders.push(path);
        }
      }
    };
    for (const root of ['../../src', '../e2e']) walk(join(__dirname, root));
    expect(offenders).toEqual([]);
  });
});
