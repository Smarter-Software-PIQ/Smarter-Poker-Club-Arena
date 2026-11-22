/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNIT TESTS - TableInviteService
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockReportError = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../../src/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

import {
  buildTableInviteTargetKey,
  fetchInvitableContacts,
  fetchUserActiveTableTarget,
  getTableInviteCooldownRemainingMs,
  resetTableInviteCooldowns,
  sendInAppTableInvite,
  TABLE_INVITE_COOLDOWN_MS,
} from '../../src/services/TableInviteService';

function createChain(resolvedValue: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single'];
  for (const method of methods) {
    chain[method] = vi.fn(() => {
      if (method === 'maybeSingle' || method === 'single') {
        return Promise.resolve(resolvedValue);
      }
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

describe('TableInviteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTableInviteCooldowns();
  });

  describe('sendInAppTableInvite guards', () => {
    it('blocks self-invites without touching the database', async () => {
      const result = await sendInAppTableInvite({
        recipientUserId: 'user-1',
        senderUserId: 'user-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-100',
        tableName: 'High Stakes NLH',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('self');
        expect(result.message).not.toMatch(/\u2014/);
      }
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('rejects missing target IDs without touching the database', async () => {
      const cashResult = await sendInAppTableInvite({
        recipientUserId: 'user-2',
        senderUserId: 'user-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: '   ',
        tableName: 'Empty Cash',
      });
      expect(cashResult).toMatchObject({ ok: false, reason: 'invalid_target' });

      const lightningResult = await sendInAppTableInvite({
        recipientUserId: 'user-2',
        senderUserId: 'user-1',
        senderName: 'KingFish',
        kind: 'lightning',
        clusterId: null,
        tableId: null,
        tableName: 'Lightning Pool',
      });
      expect(lightningResult).toMatchObject({ ok: false, reason: 'invalid_target' });

      const tourneyResult = await sendInAppTableInvite({
        recipientUserId: 'user-2',
        senderUserId: 'user-1',
        senderName: 'KingFish',
        kind: 'tournament',
        tournamentId: '',
        tableId: '',
        tableName: 'Sunday Major',
      });
      expect(tourneyResult).toMatchObject({ ok: false, reason: 'invalid_target' });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('enforces per-(recipient, target) duplicate cooldown and allows distinct targets/recipients', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: insertMock });

      const first = await sendInAppTableInvite({
        recipientUserId: 'friend-1',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-abc',
        tableName: 'PLO 1/2',
      });
      expect(first).toEqual({
        ok: true,
        actionUrl: '/table/table-abc',
        cooldownMs: TABLE_INVITE_COOLDOWN_MS,
      });
      expect(insertMock).toHaveBeenCalledTimes(1);

      const targetKey = buildTableInviteTargetKey({ kind: 'cash', tableId: 'table-abc' });
      expect(getTableInviteCooldownRemainingMs('friend-1', targetKey)).toBeGreaterThan(0);

      // Immediate duplicate for same recipient + table is blocked
      const duplicate = await sendInAppTableInvite({
        recipientUserId: 'friend-1',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-abc',
        tableName: 'PLO 1/2',
      });
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.reason).toBe('cooldown');
        expect(duplicate.retryAfterMs).toBeGreaterThan(0);
      }
      expect(insertMock).toHaveBeenCalledTimes(1);

      // Different recipient for same table succeeds
      const otherFriend = await sendInAppTableInvite({
        recipientUserId: 'friend-2',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-abc',
        tableName: 'PLO 1/2',
      });
      expect(otherFriend.ok).toBe(true);
      expect(insertMock).toHaveBeenCalledTimes(2);

      // Same recipient for a different table succeeds
      const otherTable = await sendInAppTableInvite({
        recipientUserId: 'friend-1',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-xyz',
        tableName: 'NLH 2/5',
      });
      expect(otherTable.ok).toBe(true);
      expect(insertMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendInAppTableInvite payload contract and error handling', () => {
    it('writes both snake_case and camelCase keys, canonical action_url, and Title Case copy with zero em-dashes', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: insertMock });

      const cashRes = await sendInAppTableInvite({
        recipientUserId: 'friend-9',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'tbl-42',
        clusterId: 'cl-7',
        tableName: 'Diamond Holdem',
        inviteCode: 'CLUB77',
        inviteToken: 'tok_abc',
      });

      expect(cashRes).toEqual({
        ok: true,
        actionUrl: '/table/tbl-42?i=tok_abc&cluster=cl-7&invite=CLUB77',
        cooldownMs: TABLE_INVITE_COOLDOWN_MS,
      });

      const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.user_id).toBe('friend-9');
      expect(inserted.type).toBe('table_invite');
      expect(inserted.title).toBe('Table Invite');
      expect(inserted.message).toBe('KingFish Invited You To Join Diamond Holdem');
      expect(inserted.message).not.toMatch(/\u2014/);
      expect(inserted.action_url).toBe('/table/tbl-42?i=tok_abc&cluster=cl-7&invite=CLUB77');
      expect(inserted.read).toBe(false);
      expect(inserted.data).toMatchObject({
        table_id: 'tbl-42',
        tableId: 'tbl-42',
        cluster_id: 'cl-7',
        clusterId: 'cl-7',
        tournament_id: null,
        tournamentId: null,
        kind: 'cash',
        table_name: 'Diamond Holdem',
        tableName: 'Diamond Holdem',
        invite_code: 'CLUB77',
        inviteCode: 'CLUB77',
        invite_token: 'tok_abc',
        inviteToken: 'tok_abc',
        from_user_id: 'hero-1',
        fromUserId: 'hero-1',
        from_name: 'KingFish',
        fromName: 'KingFish',
        action_url: '/table/tbl-42?i=tok_abc&cluster=cl-7&invite=CLUB77',
      });

      // Lightning invite
      const lightningRes = await sendInAppTableInvite({
        recipientUserId: 'friend-9',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'lightning',
        clusterId: 'lgt-99',
        tableName: 'Lightning 1/2',
        inviteToken: 'ltok',
      });
      expect(lightningRes).toMatchObject({
        ok: true,
        actionUrl: '/lightning/lgt-99?i=ltok',
      });
      const lightningRow = insertMock.mock.calls[1][0] as Record<string, unknown>;
      expect(lightningRow.title).toBe('Lightning Table Invite');
      expect(lightningRow.action_url).toBe('/lightning/lgt-99?i=ltok');

      // Tournament invite
      const tourneyRes = await sendInAppTableInvite({
        recipientUserId: 'friend-9',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'tournament',
        tournamentId: 'mtt-55',
        tableName: 'Nightly Freezeout',
      });
      expect(tourneyRes).toMatchObject({
        ok: true,
        actionUrl: '/tournaments/mtt-55',
      });
      const tourneyRow = insertMock.mock.calls[2][0] as Record<string, unknown>;
      expect(tourneyRow.title).toBe('Tournament Invite');
      expect(tourneyRow.action_url).toBe('/tournaments/mtt-55');
    });

    it('never fakes success on Supabase insert error, reports error, and does not trigger cooldown', async () => {
      const dbError = { message: 'RLS policy violation', code: '42501' };
      const insertMock = vi.fn().mockResolvedValueOnce({ error: dbError }).mockResolvedValueOnce({
        error: null,
      });
      mockFrom.mockReturnValue({ insert: insertMock });

      const failed = await sendInAppTableInvite({
        recipientUserId: 'friend-1',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-err',
        tableName: 'Retry Table',
      });

      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(failed.reason).toBe('insert_failed');
        expect(failed.message).toBe('Could Not Send Invite Right Now. Please Try Again.');
      }
      expect(mockReportError).toHaveBeenCalledWith(
        dbError,
        'TableInviteService.sendInAppTableInvite'
      );

      // Retry must NOT be blocked by cooldown since the first insert failed
      const retry = await sendInAppTableInvite({
        recipientUserId: 'friend-1',
        senderUserId: 'hero-1',
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'table-err',
        tableName: 'Retry Table',
      });
      expect(retry.ok).toBe(true);
    });
  });

  describe('fetchInvitableContacts', () => {
    it('merges bidirectional friends and active clubmates, prefers friend source, and excludes self/banned', async () => {
      let friendshipCall = 0;
      const profileSelectSpy = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'friendships') {
          friendshipCall++;
          if (friendshipCall === 1) {
            return createChain({
              data: [{ friend_id: 'u-alice' }, { friend_id: 'u-shared' }],
              error: null,
            });
          }
          return createChain({
            data: [{ user_id: 'u-bob' }],
            error: null,
          });
        }
        if (table === 'club_members') {
          return createChain({
            data: [
              { user_id: 'u-shared', status: 'active' },
              { user_id: 'u-clubmate', status: 'active' },
              { user_id: 'u-banned', status: 'banned' },
              { user_id: 'hero-1', status: 'active' },
            ],
            error: null,
          });
        }
        if (table === 'profiles') {
          const chain = createChain({
            data: [
              {
                id: 'u-alice',
                alias: 'AliceAce',
                username: 'alice',
                avatar_url: '/a.png',
                level: 5,
              },
              { id: 'u-bob', alias: 'BobBluff', username: 'bob', avatar_url: null, level: 2 },
              { id: 'u-shared', alias: 'SharedShark', username: 'shared', is_vip: true },
              { id: 'u-clubmate', alias: 'ClubMateZ', username: 'clubz', level: 3 },
            ],
            error: null,
          });
          const origSelect = chain.select as ReturnType<typeof vi.fn>;
          chain.select = vi.fn((cols: string) => {
            profileSelectSpy(cols);
            return origSelect(cols);
          });
          return chain;
        }
        return createChain({ data: [], error: null });
      });

      const contacts = await fetchInvitableContacts('hero-1', 'club-77');

      expect(contacts.map((c) => [c.userId, c.source])).toEqual([
        ['u-alice', 'friend'],
        ['u-bob', 'friend'],
        ['u-shared', 'friend'],
        ['u-clubmate', 'clubmate'],
      ]);
      // Enforces arena avatar separation and never queries is_horse
      expect(profileSelectSpy).toHaveBeenCalledTimes(1);
      const selectedCols = String(profileSelectSpy.mock.calls[0][0]);
      expect(selectedCols).toContain('avatar_url:arena_avatar_url');
      expect(selectedCols).not.toContain('is_horse');
    });
  });

  describe('fetchUserActiveTableTarget', () => {
    it('returns the most recent active seated cash or tournament table and skips closed tables', async () => {
      mockFrom.mockReturnValue(
        createChain({
          data: [
            {
              table_id: 't-closed',
              joined_at: '2026-11-22T02:00:00Z',
              tables: {
                id: 't-closed',
                name: 'Closed Room',
                club_id: 'c-1',
                cluster_id: null,
                tournament_id: null,
                status: 'closed',
              },
            },
            {
              table_id: 't-live',
              joined_at: '2026-11-22T01:55:00Z',
              tables: {
                id: 't-live',
                name: 'Heads Up Table 1',
                club_id: 'c-1',
                cluster_id: null,
                tournament_id: 'tourney-88',
                status: 'active',
              },
            },
          ],
          error: null,
        })
      );

      const target = await fetchUserActiveTableTarget('hero-1');
      expect(target).toEqual({
        kind: 'tournament',
        tableId: 't-live',
        tableName: 'Heads Up Table 1',
        clubId: 'c-1',
        clusterId: null,
        tournamentId: 'tourney-88',
      });
    });

    it('returns null and reports error when seat lookup fails', async () => {
      const seatErr = { message: 'timeout' };
      mockFrom.mockReturnValue(createChain({ data: null, error: seatErr }));

      const target = await fetchUserActiveTableTarget('hero-1');
      expect(target).toBeNull();
      expect(mockReportError).toHaveBeenCalledWith(
        seatErr,
        'TableInviteService.fetchUserActiveTableTarget'
      );
    });
  });
});
