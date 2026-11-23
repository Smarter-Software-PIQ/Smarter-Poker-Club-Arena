/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNIT TESTS - TableInviteService
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockReportError = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
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

  /*
   * 2026-11-22: the send goes through public.fn_send_game_invite. The browser
   * used to insert the friend's notification row itself, which production
   * refuses (no INSERT for authenticated on notifications), so every in-app
   * invite failed. Real-shaped ids: the RPC takes uuids, and made-up values
   * are how the crossed-parameter bug of #11772 was pinned as correct.
   */
  const HERO = '0a0a0a0a-1111-4222-8333-444444444444';
  const FRIEND_1 = '0b0b0b0b-1111-4222-8333-444444444444';
  const FRIEND_2 = '0c0c0c0c-1111-4222-8333-444444444444';
  const TABLE_A = '1a1a1a1a-2222-4333-8444-555555555555';
  const TABLE_B = '1b1b1b1b-2222-4333-8444-555555555555';
  const CLUSTER = '2a2a2a2a-3333-4444-8555-666666666666';
  const TOURNAMENT = '3a3a3a3a-4444-4555-8666-777777777777';
  const HOLD = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  const delivered = (path: string) => ({
    data: { ok: true, duplicate: false, path, action_url: `/hub/club-arena${path}` },
    error: null,
  });

  describe('sendInAppTableInvite guards', () => {
    it('blocks self-invites without touching the database', async () => {
      const result = await sendInAppTableInvite({
        recipientUserId: HERO,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
        tableName: 'High Stakes NLH',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('self');
        expect(result.message).not.toMatch(/\u2014/);
      }
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects missing or malformed target IDs without touching the database', async () => {
      const cashResult = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: '   ',
        tableName: 'Empty Cash',
      });
      expect(cashResult).toMatchObject({ ok: false, reason: 'invalid_target' });

      const lightningResult = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'lightning',
        clusterId: null,
        tableId: null,
        tableName: 'Lightning Pool',
      });
      expect(lightningResult).toMatchObject({ ok: false, reason: 'invalid_target' });

      const tourneyResult = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'tournament',
        tournamentId: '',
        tableId: '',
        tableName: 'Sunday Major',
      });
      expect(tourneyResult).toMatchObject({ ok: false, reason: 'invalid_target' });

      const notAUuid = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: 'tbl-42',
        tableName: 'Not A Table Id',
      });
      expect(notAUuid).toMatchObject({ ok: false, reason: 'invalid_target' });
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('enforces per-(recipient, target) duplicate cooldown and allows distinct targets/recipients', async () => {
      mockRpc.mockResolvedValue(delivered(`/table/${TABLE_A}`));

      const first = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
        tableName: 'PLO 1/2',
      });
      expect(first).toEqual({
        ok: true,
        actionUrl: `/table/${TABLE_A}`,
        cooldownMs: TABLE_INVITE_COOLDOWN_MS,
      });
      expect(mockRpc).toHaveBeenCalledTimes(1);

      const targetKey = buildTableInviteTargetKey({ kind: 'cash', tableId: TABLE_A });
      expect(getTableInviteCooldownRemainingMs(FRIEND_1, targetKey)).toBeGreaterThan(0);

      // Immediate duplicate for same recipient + table is blocked locally
      const duplicate = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
        tableName: 'PLO 1/2',
      });
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.reason).toBe('cooldown');
        expect(duplicate.retryAfterMs).toBeGreaterThan(0);
      }
      expect(mockRpc).toHaveBeenCalledTimes(1);

      // Different recipient for same table succeeds
      const otherFriend = await sendInAppTableInvite({
        recipientUserId: FRIEND_2,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
        tableName: 'PLO 1/2',
      });
      expect(otherFriend.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledTimes(2);

      // Same recipient for a different table succeeds
      const otherTable = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_B,
        tableName: 'NLH 2/5',
      });
      expect(otherTable.ok).toBe(true);
      expect(mockRpc).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendInAppTableInvite sends through the server door', () => {
    it('never inserts into notifications, and passes the normalised target to fn_send_game_invite', async () => {
      mockRpc.mockResolvedValue(
        delivered(`/table/${TABLE_A}?i=ABC2345&cluster=${CLUSTER}&invite=${HOLD}`)
      );

      const cashRes = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A.toUpperCase(),
        clusterId: CLUSTER,
        tableName: 'Diamond Holdem',
        inviteCode: 'abc2345',
        inviteToken: HOLD,
      });

      expect(cashRes).toEqual({
        ok: true,
        actionUrl: `/table/${TABLE_A}?i=ABC2345&cluster=${CLUSTER}&invite=${HOLD}`,
        cooldownMs: TABLE_INVITE_COOLDOWN_MS,
      });
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledWith('fn_send_game_invite', {
        p_recipient_id: FRIEND_1,
        p_kind: 'cash',
        p_table_id: TABLE_A,
        p_tournament_id: null,
        p_cluster_id: CLUSTER,
        p_invite_code: 'ABC2345',
        p_invite_token: HOLD,
      });

      mockRpc.mockResolvedValue(delivered(`/tournaments/${TOURNAMENT}?i=ABC2345`));
      const tourneyRes = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'tournament',
        tournamentId: TOURNAMENT,
        tableName: 'Nightly Freezeout',
        inviteCode: 'ABC2345',
      });
      expect(tourneyRes).toMatchObject({
        ok: true,
        actionUrl: `/tournaments/${TOURNAMENT}?i=ABC2345`,
      });
      expect(mockRpc).toHaveBeenLastCalledWith(
        'fn_send_game_invite',
        expect.objectContaining({ p_kind: 'tournament', p_tournament_id: TOURNAMENT })
      );
    });

    it('a repeat the server already delivered counts as sent', async () => {
      mockRpc.mockResolvedValue({
        data: { ok: true, duplicate: true, path: `/tournaments/${TOURNAMENT}` },
        error: null,
      });
      const res = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'tournament',
        tournamentId: TOURNAMENT,
        tableName: 'Nightly Freezeout',
      });
      expect(res).toMatchObject({ ok: true, actionUrl: `/tournaments/${TOURNAMENT}` });
    });

    it.each([
      ['not_allowed', 'not_allowed', 'Only Friends And Clubmates Can Be Invited To This Game.'],
      ['rate_limited', 'rate_limited', 'Too Many Invites Sent. Try Again In A Few Minutes.'],
      ['not_found', 'invalid_target', 'This Game Is No Longer Open For Invites.'],
      ['not_delivered', 'insert_failed', 'Could Not Send Invite Right Now. Please Try Again.'],
    ])(
      'a server refusal %s is reported as %s and never as sent',
      async (reason, mapped, message) => {
        mockRpc.mockResolvedValue({
          data: { ok: false, reason, retry_after_seconds: 90 },
          error: null,
        });
        const res = await sendInAppTableInvite({
          recipientUserId: FRIEND_1,
          senderUserId: HERO,
          senderName: 'KingFish',
          kind: 'cash',
          tableId: TABLE_A,
          tableName: 'PLO 1/2',
        });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.reason).toBe(mapped);
          expect(res.message).toBe(message);
          expect(res.message).not.toMatch(/\u2014/);
        }
        // A refusal starts no cooldown: the next tap asks the server again.
        expect(
          getTableInviteCooldownRemainingMs(
            FRIEND_1,
            buildTableInviteTargetKey({ kind: 'cash', tableId: TABLE_A })
          )
        ).toBe(0);
      }
    );

    it('never fakes success on an RPC error, reports error, and does not trigger cooldown', async () => {
      const dbError = { message: 'permission denied', code: '42501' };
      mockRpc
        .mockResolvedValueOnce({ data: null, error: dbError })
        .mockResolvedValueOnce(delivered(`/table/${TABLE_A}`));

      const failed = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
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

      // Retry must NOT be blocked by cooldown since the first send failed
      const retry = await sendInAppTableInvite({
        recipientUserId: FRIEND_1,
        senderUserId: HERO,
        senderName: 'KingFish',
        kind: 'cash',
        tableId: TABLE_A,
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
