// @vitest-environment happy-dom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  appendInviteNextParam,
  normalizeInviteToken,
  normalizeUuid,
  safeInviteNextPath,
} from '../../src/lib/inviteCode';
import { inviteSignupUrl } from '../../src/components/auth/InviteSignupRedirect';
import {
  evaluateMustMoveRoutingTrigger,
  MUST_MOVE_REDIRECT_TOAST,
  MUST_MOVE_WAITLISTED_TOAST,
  parseTableInviteParams,
  resolveMustMoveRoutingOutcome,
} from '../../src/lib/mustMoveInviteRouting';
import { TableLoadFailureOverlay } from '../../src/components/table/TableLoadFailureOverlay';
import { clearClubUUIDCache } from '../../src/utils/clubIdResolver';

const TABLE_UUID = '11111111-2222-4333-8444-555555555555';
const TABLE_UUID_2 = '22222222-3333-4444-8555-666666666666';
const CLUSTER_UUID = '33333333-4444-4555-8666-777777777777';
const CLUB_UUID = '44444444-5555-4666-8777-888888888888';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  join: vi.fn(),
  resolveInviteCode: vi.fn(),
  claimInvite: vi.fn(),
  rememberInviteCode: vi.fn(),
  clearPendingInviteCode: vi.fn(),
  readPendingInviteCode: vi.fn(),
  auth: { user: { id: 'player-1' } as { id: string } | null },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => mocks.auth }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/services/ClubJoinService', () => ({ ClubJoinService: { join: mocks.join } }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribeDebounced: () => () => {} },
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/components/common/PageSkeleton', () => ({
  default: () => <div data-testid="skeleton">Loading</div>,
}));
vi.mock('../../src/services/ClubInviteService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ClubInviteService')>();
  return {
    ...actual,
    resolveInviteCode: mocks.resolveInviteCode,
    claimInvite: mocks.claimInvite,
    rememberInviteCode: mocks.rememberInviteCode,
    clearPendingInviteCode: mocks.clearPendingInviteCode,
    readPendingInviteCode: mocks.readPendingInviteCode,
  };
});

import InviteCodePage from '../../src/pages/InviteCodePage';
import InvitePage from '../../src/pages/InvitePage';

function LocationProbe({ label }: { label: string }) {
  const loc = useLocation();
  return (
    <div data-testid="location-probe">
      {label}:{loc.pathname}
      {loc.search}
    </div>
  );
}

describe('safeInviteNextPath open-redirect hardening & query helpers', () => {
  it('accepts valid internal Club Arena game routes with optional query params', () => {
    expect(safeInviteNextPath(`/table/${TABLE_UUID}`)).toBe(`/table/${TABLE_UUID}`);
    expect(safeInviteNextPath(`/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`)).toBe(
      `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`
    );
    expect(safeInviteNextPath(`/lightning/${CLUSTER_UUID}`)).toBe(`/lightning/${CLUSTER_UUID}`);
    expect(safeInviteNextPath(`/tournaments/${TABLE_UUID}`)).toBe(`/tournaments/${TABLE_UUID}`);
    expect(safeInviteNextPath(`/hub/club-arena/table/${TABLE_UUID}`)).toBe(`/table/${TABLE_UUID}`);
  });

  it('rejects open redirects, schemes, traversal, backslashes, control chars, and non-game routes', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      '//evil.com/table/1',
      'https://evil.com/table/1',
      'http://smarter.poker/table/1',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/\\evil.com/table/1',
      '/table/abc\\evil',
      `/table/${TABLE_UUID}\r\nX-Injected: 1`,
      `/table/${TABLE_UUID}\u0000`,
      '/table/abc/../../clubs/1',
      '/table/..',
      '/table/%2e%2e/clubs',
      '/table/a%2fb',
      '/clubs/some-club',
      '/auth/login',
      '/table/',
      '/',
    ]) {
      expect(safeInviteNextPath(bad), `expected ${String(bad)} to be rejected`).toBeNull();
    }
  });

  it('normalizes UUIDs and invite tokens strictly', () => {
    expect(normalizeUuid(` ${CLUSTER_UUID.toUpperCase()} `)).toBe(CLUSTER_UUID);
    expect(normalizeUuid('not-a-uuid')).toBeNull();
    expect(normalizeInviteToken(' hu_tok-1234 ')).toBe('hu_tok-1234');
    expect(normalizeInviteToken('ab')).toBeNull();
    expect(normalizeInviteToken('bad token!')).toBeNull();
  });

  it('appendInviteNextParam appends only validated next paths', () => {
    expect(appendInviteNextParam('/invite/club-1?i=ABC2345', `/table/${TABLE_UUID}`)).toBe(
      `/invite/club-1?i=ABC2345&next=${encodeURIComponent(`/table/${TABLE_UUID}`)}`
    );
    expect(appendInviteNextParam('/invite/club-1?i=ABC2345', 'https://evil.com')).toBe(
      '/invite/club-1?i=ABC2345'
    );
    expect(appendInviteNextParam('/invite/club-1?i=ABC2345', null)).toBe(
      '/invite/club-1?i=ABC2345'
    );
  });
});

describe('InviteSignupRedirect preserves ?next= across signup handoff', () => {
  it('preserves ?next=/table/<uuid> on /i/<CODE> signup redirect', () => {
    const next = `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`;
    const search = `?next=${encodeURIComponent(next)}`;
    const url = inviteSignupUrl('/i/ABC2345', search);
    const q = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/auth/signup?')).toBe(true);
    expect(q.get('invite')).toBe('ABC2345');
    expect(q.get('redirect')).toBe(`/hub/club-arena/i/ABC2345${search}`);
  });

  it('preserves ?next=/table/<uuid> on /invite/<club>?i=<CODE> signup redirect', () => {
    const next = `/table/${TABLE_UUID}`;
    const search = `?i=ABC2345&next=${encodeURIComponent(next)}`;
    const url = inviteSignupUrl('/invite/kings-club', search);
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('invite')).toBe('ABC2345');
    expect(q.get('redirect')).toBe(`/hub/club-arena/invite/kings-club${search}`);
  });
});

describe('InviteCodePage & InvitePage preserve and execute ?next= end-to-end', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearClubUUIDCache();
    mocks.auth.user = { id: 'player-1' };
    mocks.readPendingInviteCode.mockReturnValue(null);
    mocks.claimInvite.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('InviteCodePage forwards /i/:code?next=/table/:id to inAppPath with ?next= preserved', async () => {
    mocks.resolveInviteCode.mockResolvedValue({
      inAppPath: `/invite/${CLUB_UUID}?i=ABC2345&ref=77`,
    });

    const next = `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`;
    render(
      <MemoryRouter initialEntries={[`/i/ABC2345?next=${encodeURIComponent(next)}`]}>
        <Routes>
          <Route path="/i/:code" element={<InviteCodePage />} />
          <Route path="/invite/:clubId" element={<LocationProbe label="invite" />} />
        </Routes>
      </MemoryRouter>
    );

    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe(
      `invite:/invite/${CLUB_UUID}?i=ABC2345&ref=77&next=${encodeURIComponent(next)}`
    );
  });

  it('InviteCodePage strips malicious ?next= values when forwarding', async () => {
    mocks.resolveInviteCode.mockResolvedValue({
      inAppPath: `/invite/${CLUB_UUID}?i=ABC2345`,
    });

    render(
      <MemoryRouter
        initialEntries={[`/i/ABC2345?next=${encodeURIComponent('//evil.com/table/1')}`]}
      >
        <Routes>
          <Route path="/i/:code" element={<InviteCodePage />} />
          <Route path="/invite/:clubId" element={<LocationProbe label="invite" />} />
        </Routes>
      </MemoryRouter>
    );

    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe(`invite:/invite/${CLUB_UUID}?i=ABC2345`);
  });

  it('InvitePage redirects an existing member directly to validated ?next= table', async () => {
    const clubRow = {
      id: CLUB_UUID,
      slug: 'kings-club',
      name: 'Kings Club',
      member_count: 50,
      is_public: true,
      asset: 'chips',
    };
    mocks.from.mockImplementation((table: string) => {
      const q = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      q.select.mockReturnValue(q);
      q.eq.mockReturnValue(q);
      if (table === 'clubs') {
        q.maybeSingle.mockResolvedValue({ data: clubRow, error: null });
      } else if (table === 'club_members') {
        q.maybeSingle.mockResolvedValue({
          data: { user_id: 'player-1', status: 'active' },
          error: null,
        });
      }
      return q;
    });

    const next = `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`;
    render(
      <MemoryRouter
        initialEntries={[`/invite/${CLUB_UUID}?i=ABC2345&next=${encodeURIComponent(next)}`]}
      >
        <Routes>
          <Route path="/invite/:clubId" element={<InvitePage />} />
          <Route path="/table/:tableId" element={<LocationProbe label="table" />} />
          <Route path="/clubs/:clubId" element={<LocationProbe label="club" />} />
        </Routes>
      </MemoryRouter>
    );

    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe(`table:${next}`);
  });

  it('InvitePage redirects a fresh join directly to validated ?next= table', async () => {
    const clubRow = {
      id: CLUB_UUID,
      slug: 'kings-club',
      name: 'Kings Club',
      member_count: 50,
      is_public: true,
      asset: 'chips',
    };
    mocks.from.mockImplementation((table: string) => {
      const q = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      q.select.mockReturnValue(q);
      q.eq.mockReturnValue(q);
      if (table === 'clubs') {
        q.maybeSingle.mockResolvedValue({ data: clubRow, error: null });
      } else if (table === 'club_members') {
        q.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      return q;
    });
    mocks.join.mockResolvedValue({ success: true, status: 'active' });

    const next = `/table/${TABLE_UUID}`;
    render(
      <MemoryRouter
        initialEntries={[`/invite/${CLUB_UUID}?i=ABC2345&next=${encodeURIComponent(next)}`]}
      >
        <Routes>
          <Route path="/invite/:clubId" element={<InvitePage />} />
          <Route path="/table/:tableId" element={<LocationProbe label="table" />} />
          <Route path="/clubs/:clubId" element={<LocationProbe label="club" />} />
        </Routes>
      </MemoryRouter>
    );

    const joinBtn = await screen.findByRole('button', { name: 'Join Club' });
    fireEvent.click(joinBtn);

    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe(`table:${next}`);
  });

  it('InvitePage falls back to /clubs/:slug when ?next= is an unsafe open redirect', async () => {
    const clubRow = {
      id: CLUB_UUID,
      slug: 'kings-club',
      name: 'Kings Club',
      member_count: 50,
      is_public: true,
      asset: 'chips',
    };
    mocks.from.mockImplementation((table: string) => {
      const q = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      q.select.mockReturnValue(q);
      q.eq.mockReturnValue(q);
      if (table === 'clubs') {
        q.maybeSingle.mockResolvedValue({ data: clubRow, error: null });
      } else if (table === 'club_members') {
        q.maybeSingle.mockResolvedValue({
          data: { user_id: 'player-1', status: 'active' },
          error: null,
        });
      }
      return q;
    });

    render(
      <MemoryRouter
        initialEntries={[
          `/invite/${CLUB_UUID}?i=ABC2345&next=${encodeURIComponent('https://evil.com/table/1')}`,
        ]}
      >
        <Routes>
          <Route path="/invite/:clubId" element={<InvitePage />} />
          <Route path="/clubs/:clubId" element={<LocationProbe label="club" />} />
        </Routes>
      </MemoryRouter>
    );

    const probe = await screen.findByTestId('location-probe');
    expect(probe.textContent).toBe('club:/clubs/kings-club');
  });
});

describe('TableLoadFailureOverlay two-plate Join Club & Open Table flow', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders two SpadeConsole plates when missing with a valid inviteCode and navigates to /i/<CODE>?next=...', async () => {
    const returnPath = `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`;
    const { container } = render(
      <MemoryRouter initialEntries={[returnPath]}>
        <Routes>
          <Route
            path="/table/:tableId"
            element={
              <TableLoadFailureOverlay
                tableLoadFailure="missing"
                exitDestination={() => '/clubs-list'}
                inviteCode="abc2345"
                returnPath={returnPath}
              />
            }
          />
          <Route path="/i/:code" element={<LocationProbe label="short-invite" />} />
        </Routes>
      </MemoryRouter>
    );

    expect(container.querySelector('.sc--plates')).not.toBeNull();
    expect(container.querySelector('.table-load-failure__way-out')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back To Lobby' })).toBeTruthy();

    const joinPlate = screen.getByRole('button', { name: 'Join Club & Open Table' });
    fireEvent.click(joinPlate);

    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe(
        `short-invite:/i/ABC2345?next=${encodeURIComponent(returnPath)}`
      );
    });
  });

  it('renders single flat-foot way-out button when missing without a valid inviteCode', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/table/${TABLE_UUID}`]}>
        <TableLoadFailureOverlay
          tableLoadFailure="missing"
          exitDestination={() => '/clubs-list'}
          inviteCode="BAD01"
          returnPath={`/table/${TABLE_UUID}`}
        />
      </MemoryRouter>
    );

    expect(container.querySelector('.sc--foot')).not.toBeNull();
    expect(container.querySelector('.table-load-failure__way-out')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Join Club & Open Table' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back To Lobby' })).toBeTruthy();
  });
});

describe('Must-Move ?cluster= smart routing logic & bounded ref guard', () => {
  it('parses valid ?i= and ?cluster= from location search and builds returnPath', () => {
    expect(
      parseTableInviteParams(TABLE_UUID, `?i=abc2345&cluster=${CLUSTER_UUID.toUpperCase()}`)
    ).toEqual({
      inviteCode: 'ABC2345',
      clusterId: CLUSTER_UUID,
      returnPath: `/table/${TABLE_UUID}?cluster=${CLUSTER_UUID}`,
    });

    expect(parseTableInviteParams(TABLE_UUID, '?i=BAD&cluster=invalid')).toEqual({
      inviteCode: null,
      clusterId: null,
      returnPath: `/table/${TABLE_UUID}`,
    });
  });

  it('triggers smart routing on missing table or full table when unseated, and stays quiet otherwise', () => {
    const base = {
      tableId: TABLE_UUID,
      clusterId: CLUSTER_UUID,
      userId: 'player-1',
      isLightningRoom: false,
      tableLoadFailure: null as 'missing' | 'unreachable' | null,
      loadedTableId: TABLE_UUID,
      loadedClusterId: CLUSTER_UUID,
      isTournament: false,
      maxPlayers: 6,
      occupiedSeats: 6,
      heroSeated: false,
    };

    expect(evaluateMustMoveRoutingTrigger(base)).toBe('full');
    expect(
      evaluateMustMoveRoutingTrigger({
        ...base,
        tableLoadFailure: 'missing',
        loadedTableId: undefined,
        occupiedSeats: 0,
      })
    ).toBe('missing');

    // Never triggers when seated, open seat exists, guest, Lightning, tournament, or unreachable.
    expect(evaluateMustMoveRoutingTrigger({ ...base, heroSeated: true })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, occupiedSeats: 5 })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, userId: 'guest' })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, isLightningRoom: true })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, isTournament: true })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, tableLoadFailure: 'unreachable' })).toBeNull();
    expect(evaluateMustMoveRoutingTrigger({ ...base, loadedTableId: TABLE_UUID_2 })).toBeNull();
  });

  it('maps joinCashGame results cleanly without self-redirect loops or em-dashes', () => {
    expect(MUST_MOVE_REDIRECT_TOAST).not.toMatch(/[\u2013\u2014]/);
    expect(MUST_MOVE_WAITLISTED_TOAST).not.toMatch(/[\u2013\u2014]/);

    expect(
      resolveMustMoveRoutingOutcome(
        { ok: true, action: 'seat', table_id: TABLE_UUID_2 },
        TABLE_UUID,
        CLUSTER_UUID
      )
    ).toEqual({
      kind: 'redirect',
      to: `/table/${TABLE_UUID_2}?cluster=${CLUSTER_UUID}`,
      toastMessage: 'Moved To An Open Table In This Game',
    });

    expect(
      resolveMustMoveRoutingOutcome(
        { ok: true, action: 'waitlisted', position: 2 },
        TABLE_UUID,
        CLUSTER_UUID
      )
    ).toEqual({
      kind: 'waitlisted',
      toastMessage: 'Table Full. Added To Game Waitlist.',
    });

    // Same table returned -> stay (no redirect loop).
    expect(
      resolveMustMoveRoutingOutcome(
        { ok: true, action: 'seat', table_id: TABLE_UUID },
        TABLE_UUID,
        CLUSTER_UUID
      )
    ).toEqual({ kind: 'stay' });
  });

  it('TablePage guards Must-Move smart routing with a bounded single-shot ref and reports errors', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    expect(page).toContain('mustMoveRoutedKeysRef');
    expect(page).toContain('evaluateMustMoveRoutingTrigger(');
    expect(page).toContain('void joinCashGame(clusterId)');
    expect(page).toContain('resolveMustMoveRoutingOutcome(res, tableId, clusterId)');
    expect(page).toContain("reportError(err, 'TablePage.mustMoveInviteRouting'");
    expect(page).toContain('inviteCode={incomingTableInvite.inviteCode}');
    expect(page).toContain('returnPath={incomingTableInvite.returnPath}');
  });
});

describe('Mobile MTT CSS law: Invite button stays visible while .lt-status is hidden', () => {
  const css = readFileSync(resolve(__dirname, '../../src/components/lobby/LobbyTable.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('does not hide tr[data-kind="mtt"] td.lt-col-status on mobile', () => {
    expect(stripped).not.toMatch(
      /\.lobby-table\s+tr\[data-kind='mtt'\]\s+td\.lt-col-status\s*\{\s*display:\s*none/
    );
  });

  it('hides only .lt-status inside MTT status cell and reserves padding-right on title', () => {
    expect(stripped).toMatch(
      /\.lobby-table\s+tr\[data-kind='mtt'\]\s+td\.lt-col-status\s+\.lt-status\s*\{\s*display:\s*none;/
    );
    const padMatches = [
      ...stripped.matchAll(
        /\.lobby-table\s+tr\[data-kind='mtt'\]\s+td\.lt-col-name\s*\{[^}]*padding-right:\s*(\d+)px/g
      ),
    ];
    expect(
      padMatches.length,
      'MTT title must reserve right padding for .lt-invite-btn'
    ).toBeGreaterThan(0);
    for (const m of padMatches) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(42);
    }
  });

  it('introduces zero :hover rules in LobbyTable.css', () => {
    expect(stripped).not.toMatch(/:hover\b/);
  });
});
