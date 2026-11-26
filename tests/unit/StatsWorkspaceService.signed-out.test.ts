import { beforeEach, describe, expect, it, vi } from 'vitest';

// Production, 2026-11-24/25: PokerIQ-Production logged "permission denied for
// table ca_stats_workspace_*" (42501) from PostgREST, about 160 times in 24h,
// every one with the anon hint. The stats page ran the owner workspace reads
// while the browser had no Supabase session, so they went out as `anon`, which
// migration 20261003140226_stats_owner_workspace deliberately locks out. The
// service must resolve the session first and send no read without one.

const { from, auth } = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { result: {} as Record<string, unknown> },
}));

vi.mock('../../src/lib/supabase', () => ({
  getAuthUser: async () => auth.result,
  supabase: { from, rpc: vi.fn() },
}));
vi.mock('../../src/services/HandNotesService', () => ({
  handNotesService: { listFor: vi.fn(async () => new Map()) },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { statsWorkspaceService } from '../../src/services/StatsWorkspaceService';

beforeEach(() => {
  from.mockReset();
  from.mockImplementation(() => {
    throw new Error('a workspace table was read without a session');
  });
});

describe('StatsWorkspaceService without a Supabase session', () => {
  it('sends no owner-only workspace read for a signed-out visitor', async () => {
    auth.result = { data: { user: null }, error: null };
    await expect(statsWorkspaceService.loadPreferences()).resolves.toEqual({
      ok: false,
      error: 'authentication_required',
    });
    await expect(statsWorkspaceService.load()).resolves.toEqual({
      ok: false,
      error: 'authentication_required',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('treats a failed session read as unknown, not as a signed-out visitor', async () => {
    auth.result = { data: { user: null }, error: new Error('getUser timeout'), failed: true };
    await expect(statsWorkspaceService.loadPreferences()).resolves.toEqual({
      ok: false,
      error: 'session_unavailable',
    });
    await expect(statsWorkspaceService.load()).resolves.toEqual({
      ok: false,
      error: 'session_unavailable',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('reads the workspace once the session is live', async () => {
    auth.result = { data: { user: { id: 'workspace-owner' } }, error: null };
    from.mockImplementation(() => ({
      select: () => ({
        maybeSingle: async () => ({
          data: { dashboard_layout: ['overview'], privacy_presentation_mode: true },
          error: null,
        }),
      }),
    }));
    await expect(statsWorkspaceService.loadPreferences()).resolves.toEqual({
      ok: true,
      data: { dashboardLayout: ['overview'], privacyPresentationMode: true },
    });
    expect(from).toHaveBeenCalledWith('ca_stats_workspace_preferences');
  });
});
