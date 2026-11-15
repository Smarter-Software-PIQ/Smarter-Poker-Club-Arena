import { expect, it, vi } from 'vitest';
const write = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../services/supabase/observedHands.js', () => ({ recordObservedHands: write }));
import { TableStateHub, type HubSubscriber } from './TableStateHub.js';
it('only live complete observers receive a durable entitlement from the transport', async () => {
  const hub = new TableStateHub();
  const sub = (userId: string): HubSubscriber => ({
    id: userId,
    userId,
    readyState: 1,
    send: vi.fn(),
  });
  const full = sub('full'),
    late = sub('late'),
    disconnected = sub('disconnected');
  hub.subscribe('table', full);
  hub.subscribe('table', disconnected);
  hub.emitEvent('table', { type: 'hand_started', hand_number: 10 });
  hub.subscribe('table', late);
  hub.unsubscribe('table', disconnected);
  hub.publish('table', { hand_number: 10, pot: 5 });
  hub.emitEvent('table', { type: 'hand_complete', hand_number: 10 });
  hub.emitEvent('table', { type: 'hand_history_saved', hand_number: 10, hand_id: 'archive' });
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith('table', 'archive', 10, ['full']));
  expect(write).toHaveBeenCalledTimes(1);
  expect(full.send).toHaveBeenCalledWith(expect.stringContaining('observed_hand_saved'));
});
