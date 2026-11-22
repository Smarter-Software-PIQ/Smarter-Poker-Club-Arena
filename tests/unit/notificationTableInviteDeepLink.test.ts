/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNIT TESTS - table_invite Notification Deep-Link Resolution & Mapping
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetNotificationsRows = vi.fn();

vi.mock('../../src/lib/supabase', () => {
  const buildChain = (): any => {
    const handler: ProxyHandler<any> = {
      get: (_target, prop) => {
        if (prop === 'maybeSingle' || prop === 'single')
          return () => Promise.resolve({ data: null, error: null });
        if (prop === 'then')
          return (resolve: (v: any) => void) =>
            resolve({ data: mockGetNotificationsRows(), error: null });
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };
  return {
    supabase: {
      from: () => buildChain(),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    },
  };
});

vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('../../src/services/MessagingService', () => ({
  messagingService: { isNotificationTypeMuted: vi.fn(() => false) },
}));

import {
  buildTableInviteDeepLink,
  notificationService,
} from '../../src/services/NotificationService';

describe('buildTableInviteDeepLink and NotificationService table_invite hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNotificationsRows.mockReturnValue([]);
  });

  it('resolves cash table invites from both camelCase and snake_case metadata', () => {
    expect(buildTableInviteDeepLink({ tableId: 'tbl-101' })).toBe('/table/tbl-101');
    expect(buildTableInviteDeepLink({ table_id: 'tbl-202', kind: 'cash' })).toBe('/table/tbl-202');
    expect(notificationService.getDeepLinkUrl('table_invite', { table_id: 'tbl-303' })).toBe(
      '/table/tbl-303'
    );
  });

  it('preserves i, cluster, and invite query params cleanly via URLSearchParams', () => {
    expect(
      buildTableInviteDeepLink({
        kind: 'cash',
        table_id: 'tbl-1',
        invite_token: 'tok+1',
        cluster_id: 'cl-8',
        invite_code: 'VIP99',
      })
    ).toBe('/table/tbl-1?i=tok%2B1&cluster=cl-8&invite=VIP99');

    expect(
      buildTableInviteDeepLink({
        kind: 'cash',
        tableId: 'tbl-2',
        inviteToken: 'abc',
        clusterId: 'cl-2',
        inviteCode: 'CODE2',
      })
    ).toBe('/table/tbl-2?i=abc&cluster=cl-2&invite=CODE2');
  });

  it('resolves lightning cluster invites and preserves optional invite token', () => {
    expect(
      buildTableInviteDeepLink({
        kind: 'lightning',
        cluster_id: 'cluster-77',
      })
    ).toBe('/lightning/cluster-77');

    expect(
      buildTableInviteDeepLink({
        kind: 'lightning',
        clusterId: 'cluster-88',
        inviteToken: 't-lightning',
        inviteCode: 'FAST',
      })
    ).toBe('/lightning/cluster-88?i=t-lightning&invite=FAST');
  });

  it('resolves tournament invites to /tournaments/:id or direct /table/:id for seat-first tables', () => {
    expect(
      buildTableInviteDeepLink({
        kind: 'tournament',
        tournament_id: 'mtt-12',
      })
    ).toBe('/tournaments/mtt-12');

    expect(
      buildTableInviteDeepLink({
        kind: 'tournament',
        tournamentId: 'mtt-34',
        inviteToken: 't-mtt',
      })
    ).toBe('/tournaments/mtt-34?i=t-mtt');

    // Seat-first Heads-Up / Spin table carries both tournament_id and table_id
    expect(
      buildTableInviteDeepLink({
        kind: 'tournament',
        tournament_id: 'hu-99',
        table_id: 'seat-first-tbl-5',
        invite_token: 'hu-tok',
      })
    ).toBe('/table/seat-first-tbl-5?i=hu-tok');
  });

  it('falls back safely to "/" when target IDs are missing or blank', () => {
    expect(buildTableInviteDeepLink(undefined)).toBe('/');
    expect(buildTableInviteDeepLink(null)).toBe('/');
    expect(buildTableInviteDeepLink({})).toBe('/');
    expect(buildTableInviteDeepLink({ kind: 'lightning', cluster_id: '   ' })).toBe('/');
    expect(buildTableInviteDeepLink({ kind: 'tournament', tournament_id: '' })).toBe('/');
    expect(notificationService.getDeepLinkUrl('table_invite', {})).toBe('/');
  });

  it('populates actionUrl and folds data + metadata in getNotifications without losing this binding', async () => {
    mockGetNotificationsRows.mockReturnValue([
      {
        id: 'notif-1',
        user_id: 'u-1',
        type: 'table_invite',
        title: 'Lightning Table Invite',
        message: 'KingFish Invited You To Join Lightning 1/2',
        data: { kind: 'lightning', cluster_id: 'cl-404', invite_token: 'tk1' },
        metadata: null,
        action_url: null,
        read: false,
        created_at: '2026-11-22T02:00:00Z',
      },
      {
        id: 'notif-2',
        user_id: 'u-1',
        type: 'table_invite',
        title: 'Table Invite',
        message: 'KingFish Invited You To Join Cash Table',
        data: { kind: 'cash', table_id: 'tbl-999' },
        metadata: null,
        action_url: '/table/tbl-999?i=explicit',
        read: true,
        created_at: '2026-11-22T01:00:00Z',
      },
    ]);

    const rows = await notificationService.getNotifications('u-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].actionUrl).toBe('/lightning/cl-404?i=tk1');
    expect(rows[0].metadata).toMatchObject({ kind: 'lightning', cluster_id: 'cl-404' });
    expect(rows[1].actionUrl).toBe('/table/tbl-999?i=explicit');
  });
});
