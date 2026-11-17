import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realtime = vi.hoisted(() => ({
  handlers: [] as Array<(payload: any) => void>,
  emit: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const result = { data: {}, error: null, count: 0 };
      const chain: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
      for (const method of ['select', 'eq', 'abortSignal']) chain[method] = () => chain;
      chain.maybeSingle = () => Promise.resolve(result);
      return chain;
    }),
  },
}));
vi.mock('@/lib/subscribeRealtime', () => ({ subscribeRealtime: vi.fn(async () => undefined) }));
vi.mock('@/core/MasterBus', () => ({
  masterBus: {
    emit: realtime.emit,
    subscribe: vi.fn(() => vi.fn()),
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: vi.fn(() => {
      const channel = {
        on: (_kind: string, filter: any, callback: any) => {
          if (filter.table === 'notifications') realtime.handlers.push(callback);
          return channel;
        },
      };
      return channel;
    }),
  },
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/cosmetics/avatarCosmetics', () => ({ resolveCosmetic: vi.fn(() => null) }));
import { useHeaderDataStore } from '@/stores/useHeaderDataStore';
const notices = () => realtime.emit.mock.calls.filter(([type]) => type === 'NOTIFICATION_RECEIVED');
const inserted = (user: string, type = 'promo_play_through') => ({
  eventType: 'INSERT',
  new: { id: 'notice', user_id: user, type, data: { event: 'source_review_released' } },
});

describe('the mounted header channel refreshes promo recipients', () => {
  beforeEach(() => {
    localStorage.clear();
    realtime.handlers = [];
    realtime.emit.mockClear();
  });
  afterEach(() => {
    useHeaderDataStore.getState().teardown();
  });
  it('forwards only an inserted promo notice for its current authenticated user', () => {
    useHeaderDataStore.getState().loadOnce('player-a');
    const receive = realtime.handlers[0];
    const payload = inserted('player-a');
    receive(payload);
    expect(notices()).toEqual([['NOTIFICATION_RECEIVED', { notification: payload.new }]]);
    receive(inserted('another-player'));
    receive(inserted('player-a', 'new_message'));
    receive({ ...payload, eventType: 'UPDATE' });
    receive({ eventType: 'DELETE', old: payload.new });
    expect(notices()).toHaveLength(1);
  });
  it('ignores a former user channel after a switch or teardown', () => {
    useHeaderDataStore.getState().loadOnce('player-a');
    const oldReceive = realtime.handlers[0];
    useHeaderDataStore.getState().teardown();
    useHeaderDataStore.getState().loadOnce('player-b');
    oldReceive(inserted('player-a'));
    expect(notices()).toHaveLength(0);
    const currentReceive = realtime.handlers[1];
    currentReceive(inserted('player-b'));
    expect(notices()).toHaveLength(1);
    useHeaderDataStore.getState().teardown();
    currentReceive(inserted('player-b'));
    expect(notices()).toHaveLength(1);
  });
});
