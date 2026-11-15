import { expect, it, vi } from 'vitest';
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
  const receipts = [{ table_id: 'table', hand_number: 10, viewer_id: 'full' }];
  expect(hub.completedObserverReceipts('table', 10)).toEqual(receipts);
  // An interrupted archive request can reuse exactly these immutable facts.
  expect(hub.completedObserverReceipts('table', 10)).toEqual(receipts);
  hub.emitEvent('table', { type: 'hand_history_saved', hand_number: 10, hand_id: 'archive' });
  expect(hub.completedObserverReceipts('table', 10)).toEqual([]);
  expect(full.send).toHaveBeenCalledWith(expect.stringContaining('observed_hand_saved'));
});
