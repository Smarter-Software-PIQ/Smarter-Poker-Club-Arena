import { describe, expect, it } from 'vitest';
import { ObservedHands } from './ObservedHands.js';
describe('completed observer entitlement', () => {
  it('requires one connection from start through completion, deduplicates users and consumes once', () => {
    const tracker = new ObservedHands<{ userId?: string }>();
    const a = { userId: 'a' },
      a2 = { userId: 'a' },
      b = { userId: 'b' },
      guest = {};
    tracker.start('t', 10, [a, a2, b, guest]);
    tracker.leave(a, 't');
    tracker.missed('t', b);
    tracker.finish('t', 10);
    expect(tracker.take('t', 10)).toEqual(['a']);
    expect(tracker.take('t', 10)).toEqual([]);
  });
  it('rejects a mid-hand join or reconnect, wrong completion and room teardown', () => {
    const t = new ObservedHands<{ userId: string }>();
    const peer = { userId: 'x' };
    t.start('table', 1, [peer]);
    t.finish('table', 2);
    expect(t.take('table', 2)).toEqual([]);
    t.leave(peer);
    t.finish('table', 1);
    expect(t.take('table', 1)).toEqual([]);
    t.start('table', 3, [peer]);
    t.clear('table');
    t.finish('table', 3);
    expect(t.take('table', 3)).toEqual([]);
  });
  it('keeps completed viewing after disconnect while the archive commits', () => {
    const t = new ObservedHands<{ userId: string }>();
    const peer = { userId: 'x' };
    t.start('table', 1, [peer]);
    t.finish('table', 1);
    t.leave(peer);
    expect(t.take('table', 1)).toEqual(['x']);
  });
});
