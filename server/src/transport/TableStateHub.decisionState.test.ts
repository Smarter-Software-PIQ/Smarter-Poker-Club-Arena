import { describe, expect, it, vi } from 'vitest';
import { TableStateHub, type HubSubscriber } from './TableStateHub.js';

const TABLE = 'cash-table';
const SOFT = 256 * 1024;

function subscriber(id: string) {
  const frames: any[] = [];
  const sub = {
    id,
    readyState: 1,
    bufferedAmount: 0,
    frames,
    send: vi.fn((data: string) => {
      frames.push(JSON.parse(data));
    }),
    evict: vi.fn(),
  } satisfies HubSubscriber & { frames: any[] };
  return sub;
}

const preflop = { stage: 'preflop', current_bet: 1, action_context: 'hand-7:preflop:3' };
const flop = { stage: 'flop', current_bet: 0, action_context: 'hand-7:flop:4' };
const turn = { type: 'turn_change', action_context: flop.action_context, seat: 1 };

describe('a new decision follows the state its subscriber missed', () => {
  it('queues the full current public state before a turn after a soft-dropped DELTA', () => {
    const hub = new TableStateHub();
    const slow = subscriber('slow');
    const fast = subscriber('fast');
    hub.subscribe(TABLE, slow);
    hub.subscribe(TABLE, fast);
    hub.publish(TABLE, preflop);
    slow.bufferedAmount = SOFT + 1;
    hub.publish(TABLE, flop);
    expect(slow.frames.map((f) => f.type)).toEqual(['SNAPSHOT']);
    // The physical socket drains between two server sends; no TCP reordering.
    slow.bufferedAmount = 0;
    hub.emitEvent(TABLE, turn);
    expect(slow.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT']);
    expect(slow.frames[1]).toEqual({ type: 'SNAPSHOT', tableId: TABLE, seq: 2, state: flop });
    expect(slow.frames[2].payload).toEqual(turn);
    expect(fast.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'DELTA', 'EVENT']);
    expect(fast.frames[2].seq).toBe(slow.frames[2].seq);
    // No extra full snapshot once this subscriber is coherent again.
    hub.emitEvent(TABLE, turn);
    expect(slow.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT', 'EVENT']);
  });
  function missedFlop(hub: TableStateHub, sub: ReturnType<typeof subscriber>) {
    hub.subscribe(TABLE, sub);
    hub.publish(TABLE, preflop);
    sub.bufferedAmount = SOFT + 1;
    hub.publish(TABLE, flop);
    sub.bufferedAmount = 0;
  }

  it('does not mistake a later accepted DELTA for a repaired baseline', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    const latest = { ...flop, pot: 12 };
    hub.publish(TABLE, latest);
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'DELTA', 'SNAPSHOT', 'EVENT']);
    expect(sub.frames[2].state).toEqual(latest);
    expect(sub.frames[2].seq).toBe(3);
  });

  it('withholds the decision when recovery throws and retries only at another send opportunity', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    sub.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });
    hub.emitEvent(TABLE, turn);
    expect(sub.frames).toHaveLength(1);
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT']);
    expect(sub.frames[2].seq).toBe(2);
  });

  it('also remembers a failed initial snapshot and a thrown DELTA', () => {
    for (const failedType of ['SNAPSHOT', 'DELTA']) {
      const hub = new TableStateHub();
      const sub = subscriber(failedType);
      hub.subscribe(TABLE, sub);
      if (failedType === 'DELTA') hub.publish(TABLE, preflop);
      sub.send.mockImplementationOnce(() => {
        throw new Error('send failed');
      });
      hub.publish(TABLE, flop);
      hub.emitEvent(TABLE, turn);
      expect(sub.frames.slice(-2).map((f) => f.type)).toEqual(['SNAPSHOT', 'EVENT']);
      expect(sub.frames.at(-2).state).toEqual(flop);
    }
  });

  it('immediately evicts at HARD or removes a closed adapter', () => {
    for (const pressure of [4 * 1024 * 1024 + 1, 'closed'] as const) {
      const hub = new TableStateHub();
      const sub = subscriber('slow');
      missedFlop(hub, sub);
      if (pressure === 'closed') sub.readyState = 3;
      else sub.bufferedAmount = pressure;
      const calls = sub.send.mock.calls.length;
      for (let n = 0; n < 3; n++) hub.emitEvent(TABLE, turn);
      expect(sub.send).toHaveBeenCalledTimes(calls);
      expect(sub.evict).toHaveBeenCalledTimes(
        typeof pressure === 'number' && pressure > 4 * 1024 * 1024 ? 1 : 0
      );
      expect(hub.subscriberCount(TABLE)).toBe(0);
    }
  });

  it('queues recovery and its decision while still above SOFT, without waiting for another event', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    sub.bufferedAmount = SOFT + 1;
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT']);
    expect(sub.frames[1].state).toEqual(flop);
    // Ordinary noncritical events and DELTAs still drop at SOFT.
    hub.emitEvent(TABLE, { type: 'player_action' });
    hub.publish(TABLE, { ...flop, pot: 20 });
    expect(sub.frames).toHaveLength(3);
  });

  it('does not drop the decision when its recovery snapshot crosses SOFT', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    sub.send.mockImplementationOnce((raw) => {
      sub.frames.push(JSON.parse(raw));
      sub.bufferedAmount = SOFT + 1;
    });
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT']);
    expect(sub.evict).not.toHaveBeenCalled();
  });

  it('rechecks HARD after the recovery frame itself fills the physical send buffer', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    sub.send.mockImplementationOnce((raw) => {
      sub.frames.push(JSON.parse(raw));
      sub.bufferedAmount = 4 * 1024 * 1024 + 1;
    });
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT']);
    expect(sub.evict).toHaveBeenCalledTimes(1);
  });

  it('explicit RESYNC and a new subscription repair the baseline without redundant snapshots', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    expect(hub.resync(TABLE, sub)).toBe(true);
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'SNAPSHOT', 'EVENT']);
    hub.unsubscribeAll(sub);
    const replacement = subscriber('replacement');
    hub.subscribe(TABLE, replacement);
    hub.emitEvent(TABLE, turn);
    expect(replacement.frames.map((f) => f.type)).toEqual(['SNAPSHOT', 'EVENT']);
    // Reused adapters also receive the normal subscription snapshot.
    hub.subscribe(TABLE, sub);
    hub.emitEvent(TABLE, turn);
    expect(sub.frames.slice(-2).map((f) => f.type)).toEqual(['SNAPSHOT', 'EVENT']);
  });

  it('keeps loss per room on a shared subscriber and clears it with the restart snapshot', () => {
    const hub = new TableStateHub();
    const sub = subscriber('mux');
    hub.subscribe('other-table', sub);
    hub.publish('other-table', preflop);
    missedFlop(hub, sub);
    const before = sub.frames.length;
    hub.emitEvent('other-table', { ...turn, action_context: preflop.action_context });
    expect(sub.frames.slice(before).map((f) => f.type)).toEqual(['EVENT']);
    hub.dropTable(TABLE);
    hub.publish(TABLE, { ...flop, action_context: 'new-engine:flop:4' });
    const restarted = sub.frames.length;
    hub.emitEvent(TABLE, { ...turn, action_context: 'new-engine:flop:4' });
    expect(sub.frames.slice(restarted).map((f) => f.type)).toEqual(['EVENT']);
    expect(sub.frames.at(-2)).toMatchObject({ type: 'SNAPSHOT', seq: 1 });
  });

  it('still retires a dirty closed adapter while its room awaits a restart snapshot', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    hub.dropTable(TABLE);
    sub.readyState = 3;
    hub.emitEvent(TABLE, turn);
    expect(hub.subscriberCount(TABLE)).toBe(0);
  });

  it('keeps retained event delivery and replay deduplication independent of state recovery', () => {
    const hub = new TableStateHub();
    const sub = subscriber('slow');
    missedFlop(hub, sub);
    const retainedTurn = { ...turn, replay_until: Date.now() + 5000 };
    sub.send.mockImplementationOnce(() => {
      throw new Error('recovery failed');
    });
    hub.emitEvent(TABLE, retainedTurn);
    expect(sub.frames).toHaveLength(1);
    hub.resync(TABLE, sub);
    expect(sub.frames.slice(-2).map((f) => f.type)).toEqual(['SNAPSHOT', 'EVENT']);
    expect(sub.frames.at(-1).payload).toMatchObject({ ...retainedTurn, replayed: true });
    const replayCount = sub.frames.filter((f) => f.type === 'EVENT').length;
    hub.resync(TABLE, sub);
    expect(sub.frames.filter((f) => f.type === 'EVENT')).toHaveLength(replayCount);
  });
});
