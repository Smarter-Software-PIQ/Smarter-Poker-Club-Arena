/**
 * Table Chat shows real sender names (2026-11-28).
 *
 * Every line in Table Chat said "Player" at a table of named seats, because
 * the name was looked up once in the seat list when the row arrived and the
 * fallback was frozen into the message. History loads before seats, and a
 * sender who left (or an observer) is never seated. The name is now resolved
 * on read: seat name, then the sender's public handle from `profiles`, and the
 * neutral label only when that read fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  history: [] as any[],
  profiles: { data: [] as any[] | null, error: null as any },
  profileReads: [] as string[][],
}));

vi.mock('../../src/lib/supabase', () => {
  const chatQuery: any = {
    select: vi.fn(() => chatQuery),
    eq: vi.fn(() => chatQuery),
    order: vi.fn(() => chatQuery),
    limit: vi.fn(async () => ({ data: [...h.history], error: null })),
    insert: vi.fn(async () => ({ data: null, error: null })),
  };
  const profileQuery: any = {
    select: vi.fn(() => profileQuery),
    in: vi.fn(async (_col: string, ids: string[]) => {
      h.profileReads.push([...ids]);
      return h.profiles;
    }),
  };
  return {
    supabase: {
      rpc: vi.fn(async () => ({ data: false, error: null })),
      from: vi.fn((table: string) => (table === 'profiles' ? profileQuery : chatQuery)),
    },
  };
});
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useTableChat, resolveChatSenderNames } from '../../src/hooks/useTableChat';

const row = (id: string, user_id: string, message: string, at: string) => ({
  id,
  table_id: 't1',
  user_id,
  message,
  message_type: 'player',
  created_at: at,
});

beforeEach(() => {
  h.history = [];
  h.profiles = { data: [], error: null };
  h.profileReads = [];
});
afterEach(cleanup);

describe('Table Chat names its senders', () => {
  it('history loaded before the seats gets the seat names once the seats arrive', async () => {
    h.history = [
      row('r2', 'cole', 'nice hand', '2026-11-28T10:00:02Z'),
      row('r1', 'kicker', 'gl all', '2026-11-28T10:00:01Z'),
    ];
    const { result, rerender } = renderHook(({ players }) => useTableChat('t1', 'me', players), {
      initialProps: { players: [] as any[] },
    });
    await waitFor(() => expect(result.current.chatMessages).toHaveLength(2));

    rerender({
      players: [
        { id: 'kicker', name: 'kickerprof' },
        { id: 'cole', name: 'OldCole' },
      ],
    });
    await waitFor(() =>
      expect(result.current.chatMessages.map((m) => m.playerName)).toEqual([
        'kickerprof',
        'OldCole',
      ])
    );
  });

  it('a sender who has left the table is named from their public profile', async () => {
    h.history = [row('r1', 'gone', 'gg', '2026-11-28T10:00:01Z')];
    h.profiles = {
      data: [{ id: 'gone', username: 'hustler_07', alias: null, display_name: null }],
      error: null,
    };
    const { result } = renderHook(() =>
      useTableChat('t1', 'me', [{ id: 'kicker', name: 'kickerprof' }])
    );
    await waitFor(() => expect(result.current.chatMessages[0]?.playerName).toBe('hustler_07'));
    expect(h.profileReads).toEqual([['gone']]);
  });

  it('falls back to the neutral label only when the name cannot be read', async () => {
    h.history = [row('r1', 'ghost', 'hi', '2026-11-28T10:00:01Z')];
    h.profiles = { data: null, error: { code: '500', message: 'unreachable' } };
    const { result } = renderHook(() => useTableChat('t1', 'me', []));
    await waitFor(() => expect(h.profileReads).toHaveLength(1));
    await waitFor(() => expect(result.current.chatMessages[0]?.playerName).toBe('Player'));
    // A failed read is not retried in a loop.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.profileReads).toHaveLength(1);
  });

  it('a seat name outranks the profile, and system and dealer lines are untouched', () => {
    const out = resolveChatSenderNames(
      [
        { id: 'a', type: 'PLAYER', playerId: 'horse1', content: 'x', timestamp: new Date() },
        { id: 'b', type: 'SYSTEM', playerName: 'System', content: 'y', timestamp: new Date() },
        { id: 'c', type: 'DEALER', playerName: 'Dealer', content: 'z', timestamp: new Date() },
      ],
      [{ id: 'horse1', name: 'OldCole' }],
      new Map([['horse1', 'stale']])
    );
    expect(out.map((m) => m.playerName)).toEqual(['OldCole', 'System', 'Dealer']);
  });
});
