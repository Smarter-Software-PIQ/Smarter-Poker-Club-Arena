/**
 * A CONVERTED LIGHTNING SEAT FOLLOWS ITS CHAIR - LAW (Dan 2026-11-14).
 *
 * Verbatim: "I WAS PLAYING LIGHTNING GAMES AND FOLDED AND WAS MOVED TO THE
 * NEXT HAND... BUT THEN I WASN'T DEALT IN, IT WAS LIKE I WAS 'OBSERVING' MY
 * AVATAR WAS NOT IN THE 'HERO LOCATION' AND I DIDN'T RECEIVE MY CARDS. EVEN
 * AFTER A HARD REFRESH..."
 *
 * Production, that morning: PLO4 1/2 converted to Lightning at 14:59:32 UTC.
 * The pool dealt KingFish hands 59297194 and 59297270 while his tab stayed on
 * the feeder table's public projection; both folded on the clock after 38 s,
 * the second with his own seat showing TIME BANK in front of him. The anchor
 * hand-off had found his open room and was waiting for a View Game tap, and
 * that notice sat in the last branch of the footer chain, behind "Seat
 * Reserved, You'll Be Dealt In Next Hand" and "Join Lightning", so it never
 * rendered. A hard refresh mounted the same anchor and the same hidden notice.
 *
 * The rule, pinned here:
 *   1. A funded seat whose game converted is carried to its open room IN
 *      PLACE (THE TAB FOLLOWS THE CHAIR, Dan 2026-09-05), exactly once, with
 *      no gesture - from the mount read, the room signal, or a conversion cue
 *      when the at-most-once signal was missed.
 *   2. Never another table's room, never a Classic game, never an unfunded or
 *      departing seat.
 *   3. "Joining Lightning..." is the first branch of the footer chain, and the
 *      conversion's VIEW GAME fallback is mounted over the table area: no
 *      footer can shadow either again.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLUSTER = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '33333333-3333-4333-8333-333333333333';
const OTHER_TABLE = '99999999-9999-4999-8999-999999999999';
const POOL = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

const rpc = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
/* tests/setup.ts mocks MasterBus with no-ops; the room signal needs delivery. */
const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
  return {
    masterBus: {
      subscribe: (type: string, handler: (event: { payload: unknown }) => void) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(handler);
        return () => handlers.get(type)?.delete(handler);
      },
      emit: (type: string, payload: unknown) => {
        handlers.get(type)?.forEach((handler) => handler({ payload }));
      },
      reset: () => handlers.clear(),
    },
  };
});
vi.mock('../../src/core/MasterBus', () => ({ masterBus: bus.masterBus }));

import {
  LIGHTNING_ROOM_OPENED_EVENT,
  useLightningAnchorHandoff,
} from '../../src/lightning/useLightningAnchorHandoff';
import {
  getLightningPoolSession,
  resetLightningRegistryForTests,
} from '../../src/lightning/lightningSession';

const OPEN_HERE = {
  pool_session_id: POOL,
  state: 'active',
  cluster_mode: 'lightning',
  stack: 552.6,
  in_hand: true,
  anchor_table_id: ANCHOR,
  seat_number: 1,
  occupancy_id: null,
};
const NOT_YET = { pool_session_id: null, cluster_mode: 'pending_on' };

const ROOT = resolve(__dirname, '../..');
const PAGE = readFileSync(join(ROOT, 'src/pages/TablePage.tsx'), 'utf8');

function mountConverted(
  over: Partial<Parameters<typeof useLightningAnchorHandoff>[0]> = {},
  follow = vi.fn()
) {
  const hook = renderHook(
    (props: { cue: string }) =>
      useLightningAnchorHandoff({
        tableId: ANCHOR,
        clusterId: CLUSTER,
        userId: USER,
        isPoolSession: false,
        heroBoughtIn: false,
        existingAnchorFunded: true,
        conversionCue: props.cue,
        follow,
        ...over,
      }),
    { initialProps: { cue: 'table:must_move' } }
  );
  return { ...hook, follow };
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  bus.masterBus.reset();
  vi.useFakeTimers();
  sessionStorage.clear();
  resetLightningRegistryForTests();
  rpc.mockReset().mockResolvedValue({ data: NOT_YET, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a converted seat is carried to its room without a gesture', () => {
  it('the mount read finds the open room on this anchor and follows it once', async () => {
    rpc.mockResolvedValue({ data: OPEN_HERE, error: null });
    const { follow, result } = mountConverted();
    await settle();
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith(POOL);
    expect(getLightningPoolSession(POOL)?.clusterId).toBe(CLUSTER);
    expect(result.current.readyPoolSessionId).toBe(POOL);
  });

  it('the conversion signal carries a seat that was sitting on the anchor', async () => {
    const { follow } = mountConverted();
    await settle();
    expect(follow).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: OPEN_HERE, error: null });
    await act(async () => {
      bus.masterBus.emit(LIGHTNING_ROOM_OPENED_EVENT, { userId: USER, clusterId: CLUSTER });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith(POOL);
  });

  it('a missed signal is recovered by the conversion cue the anchor already receives', async () => {
    const { follow, rerender } = mountConverted();
    await settle();
    const reads = rpc.mock.calls.length;
    rpc.mockResolvedValue({ data: OPEN_HERE, error: null });
    // No signal at all: the engine starts projecting Lightning hands here.
    rerender({ cue: 'observer:lightning' });
    await settle();
    expect(rpc.mock.calls.length).toBe(reads + 1);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith(POOL);
  });

  it('the cue never polls: an unchanged cue asks nothing, and no timer is armed', async () => {
    const { rerender } = mountConverted();
    await settle();
    const reads = rpc.mock.calls.length;
    rerender({ cue: 'table:must_move' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(rpc.mock.calls.length).toBe(reads);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Sit Down (recheck) asks once and follows an open room', async () => {
    const { follow, result } = mountConverted();
    await settle();
    rpc.mockResolvedValue({ data: OPEN_HERE, error: null });
    await act(async () => {
      result.current.recheck();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(follow).toHaveBeenCalledTimes(1);
  });
});

describe('it never carries a seat anywhere else', () => {
  it('a room anchored at another table is not followed', async () => {
    rpc.mockResolvedValue({ data: { ...OPEN_HERE, anchor_table_id: OTHER_TABLE }, error: null });
    const { follow, result } = mountConverted();
    await settle();
    expect(follow).not.toHaveBeenCalled();
    expect(result.current.readyPoolSessionId).toBeNull();
  });

  it('an ended session is not followed', async () => {
    rpc.mockResolvedValue({ data: { ...OPEN_HERE, state: 'closed' }, error: null });
    const { follow } = mountConverted();
    await settle();
    expect(follow).not.toHaveBeenCalled();
  });

  it('a Classic game (no Lightning cluster) is never read', async () => {
    const { follow } = mountConverted({ clusterId: null });
    await settle();
    expect(rpc).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });

  it('an unfunded or departing seat is never read', async () => {
    const { follow } = mountConverted({ existingAnchorFunded: false });
    await settle();
    expect(rpc).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });

  it('a room page is never handed off again', async () => {
    const { follow } = mountConverted({ isPoolSession: true });
    await settle();
    expect(rpc).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });
});

describe('TablePage: no footer can hide the way to the seat', () => {
  const chainStart = PAGE.indexOf('<div className="action-panel-wrapper">');
  const chain = PAGE.slice(chainStart);

  it('"Joining Lightning..." is the first branch of the footer chain', () => {
    const joining = chain.indexOf(
      '{lightningHandoff.joining && !lightningRoom ? (\n          <LightningJoining onCancel={lightningHandoff.cancel} />'
    );
    expect(joining).toBeGreaterThan(0);
    for (const later of [
      'data-state="waiting-for-button"',
      'data-state="lightning-between-hands"',
      "Seat Reserved, You'll Be Dealt In Next Hand",
      'onClick={openLightningAnchorEntry}',
    ]) {
      const at = chain.indexOf(later);
      expect(at, later).toBeGreaterThan(joining);
    }
  });

  it('the conversion VIEW GAME fallback is mounted over the table area, before the footer', () => {
    const notice = PAGE.indexOf('text="Your Game Is Now Lightning. Your Seat Is Ready."');
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThan(chainStart);
    expect(PAGE.split('text="Your Game Is Now Lightning. Your Seat Is Ready."')).toHaveLength(2);
  });

  it('the hand-off is told when the anchor starts projecting Lightning or its game mode moves', () => {
    const call = PAGE.slice(PAGE.indexOf('const lightningHandoff = useLightningAnchorHandoff({'));
    const input = call.slice(0, call.indexOf('follow: (poolSessionId) => {'));
    expect(input).toMatch(/conversionCue: `\$\{lightningObserver \? 'observer' : 'table'\}:\$\{/);
    expect(input).toContain('tableGameLightningState?.clusterMode');
  });
});
