/**
 * Dan 2026-11-10: "display only authoritative assignments and handle
 * reassignment, cancellation and reconnect without stale players or card
 * leakage." The engine's pool waiting count (USER_EVENT
 * 'lightning_pool_waiting') is not an assignment: the players it counts may
 * never sit at the hero's table. It is consumed and ignored, and no seat is
 * ever drawn from it. A Lightning room's open chair draws nothing until the
 * formed hand's snapshot seats a real player there.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { noteLightningUserEvent } from '../../src/lightning/lightningDecisionQueue';
import SeatSlot from '../../src/components/table/SeatSlot';

describe('a pool waiting count is not a seat', () => {
  it('is consumed and draws nothing', () => {
    expect(
      noteLightningUserEvent({
        type: 'lightning_pool_waiting',
        pool_session_id: '11111111-1111-4111-8111-111111111111',
        waiting: 6,
      })
    ).toBe(true);
  });

  it('nothing in the table reads it', () => {
    expect(existsSync('src/lightning/lightningPoolArrivals.ts')).toBe(false);
    const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
    const seat = readFileSync('src/components/table/SeatSlot.tsx', 'utf8');
    const css = readFileSync('src/components/table/SeatSlot.css', 'utf8');
    for (const src of [page, seat])
      expect(src).not.toMatch(/lightning_pool_waiting|lightningPoolWaiting|lightningArrivingSeats/);
    expect(seat).not.toMatch(/\barriving\??:/);
    expect(css).not.toContain('seat--arriving');
  });

  it("a Lightning room's open chair draws nothing", () => {
    const { container } = render(
      <SeatSlot seatNumber={3} player={null} canSit={false} hideEmptyChair />
    );
    expect(container.querySelector('.seat--empty-hidden')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

/*
 * The seats come only from the formed hand's own snapshot roster
 * (useSeatArrivals over the engine's players). These pin what that ledger
 * does across a void, a different table and a RESYNC.
 */
import { nextSeatArrivals } from '../../src/components/table/seatArrival';

const HERO = { id: 'hero', isHero: true };
const p = (id: string) => ({ id });
const empty = { scope: 'room', signature: '', known: [], serial: 0, arrivals: {} };
const spacing = { stepMs: 120, maxDelayMs: 420 };

describe('the seats follow the authoritative table only', () => {
  it('a hand voided during its arrivals leaves no player arriving', () => {
    const dealt = nextSeatArrivals(empty, 'room', [HERO, p('a'), p('b'), null], 41, spacing);
    expect(Object.values(dealt.arrivals).map((a) => a.playerId)).toEqual(['a', 'b']);
    // The engine's idle shape: players [].
    const voided = nextSeatArrivals(dealt, 'room', [], 41, spacing);
    expect(voided.arrivals).toEqual({});
  });

  it('the next table brings only its own players, never one from the voided table', () => {
    const first = nextSeatArrivals(empty, 'room', [HERO, p('a'), p('b'), null], 41, spacing);
    const idle = nextSeatArrivals(first, 'room', [], 41, spacing);
    const next = nextSeatArrivals(idle, 'room', [p('c'), HERO, null, p('d')], 42, spacing);
    const arriving = Object.values(next.arrivals).map((a) => a.playerId);
    expect(arriving.sort()).toEqual(['c', 'd']);
    expect(arriving).not.toContain('a');
    expect(arriving).not.toContain('b');
  });

  it('a RESYNC of the same table replays nothing and keeps the arrivals in flight', () => {
    const dealt = nextSeatArrivals(empty, 'room', [HERO, p('a'), p('b')], 41, spacing);
    const resync = nextSeatArrivals(dealt, 'room', [HERO, p('a'), p('b')], 41, spacing);
    expect(resync).toBe(dealt);
  });

  it('a different room never inherits another room’s players', () => {
    const dealt = nextSeatArrivals(empty, 'room', [HERO, p('a')], 41, spacing);
    const other = nextSeatArrivals(dealt, 'other-room', [HERO, p('z')], 7, spacing);
    expect(Object.values(other.arrivals).map((a) => a.playerId)).toEqual(['z']);
  });
});
