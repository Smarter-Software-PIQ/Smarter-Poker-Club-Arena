/**
 * REAL ARRIVALS WHILE WAITING (Dan 2026-11-10): "the transition to the next
 * game feels fake, you are just sitting there, and then all at once all the
 * players appear". Between hands the engine tells the waiting room how many
 * legal players are waiting for the next table (USER_EVENT
 * 'lightning_pool_waiting'). The felt draws one anonymous arriving chair per
 * OTHER waiting player, clockwise from the hero, and nothing when the engine
 * has said nothing in this wait.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  lightningArrivingSeats,
  lightningPoolWaitingFor,
  noteLightningPoolWaiting,
  resetLightningPoolWaitingForTests,
} from '../../src/lightning/lightningPoolArrivals';
import { noteLightningUserEvent } from '../../src/lightning/lightningDecisionQueue';
import SeatSlot from '../../src/components/table/SeatSlot';

const ROOM = '11111111-1111-4111-8111-111111111111';
const base = {
  heroWaiting: true,
  sittingOut: false,
  heroSeat: 1,
  seatCount: 6,
  occupied: () => false,
};

beforeEach(() => resetLightningPoolWaitingForTests());

describe('the waiting count reaches the room', () => {
  it('is consumed from the private frame, per room', () => {
    expect(
      noteLightningUserEvent({ type: 'lightning_pool_waiting', pool_session_id: ROOM, waiting: 4 })
    ).toBe(true);
    expect(lightningPoolWaitingFor(ROOM)?.waiting).toBe(4);
    expect(lightningPoolWaitingFor('other')).toBeNull();
  });

  it('a malformed count is consumed and changes nothing', () => {
    noteLightningPoolWaiting({ type: 'lightning_pool_waiting', pool_session_id: ROOM, waiting: 3 });
    noteLightningPoolWaiting({
      type: 'lightning_pool_waiting',
      pool_session_id: ROOM,
      waiting: -1,
    });
    noteLightningPoolWaiting({
      type: 'lightning_pool_waiting',
      pool_session_id: ROOM,
      waiting: 'x',
    });
    expect(lightningPoolWaitingFor(ROOM)?.waiting).toBe(3);
  });
});

describe('which chairs show a player arriving', () => {
  it('one chair per other waiting player, clockwise from the hero', () => {
    const entry = { waiting: 4, receivedAtMs: 1 };
    expect([...lightningArrivingSeats({ ...base, heroSeat: 5, entry, staleEntry: null })]).toEqual([
      6, 1, 2,
    ]);
  });

  it('never more than the open chairs, and skips a taken one', () => {
    const entry = { waiting: 20, receivedAtMs: 1 };
    const seats = lightningArrivingSeats({
      ...base,
      entry,
      staleEntry: null,
      occupied: (s) => s === 3,
    });
    expect([...seats]).toEqual([2, 4, 5, 6]);
  });

  it('nothing for the hero alone, a stale count, a hand on the felt, or a sit out', () => {
    const entry = { waiting: 3, receivedAtMs: 1 };
    expect(
      lightningArrivingSeats({ ...base, entry: { waiting: 1, receivedAtMs: 1 }, staleEntry: null })
        .size
    ).toBe(0);
    expect(lightningArrivingSeats({ ...base, entry, staleEntry: entry }).size).toBe(0);
    expect(
      lightningArrivingSeats({ ...base, entry, staleEntry: null, heroWaiting: false }).size
    ).toBe(0);
    expect(
      lightningArrivingSeats({ ...base, entry, staleEntry: null, sittingOut: true }).size
    ).toBe(0);
    expect(lightningArrivingSeats({ ...base, entry: null, staleEntry: null }).size).toBe(0);
    expect(lightningArrivingSeats({ ...base, entry, staleEntry: null, heroSeat: 0 }).size).toBe(0);
  });
});

describe('the arriving chair', () => {
  it('draws an anonymous player, never a name or a stack', () => {
    const { getByTestId, container } = render(
      <SeatSlot seatNumber={3} player={null} canSit={false} hideEmptyChair arriving />
    );
    const seat = getByTestId('seat-arriving-3');
    expect(seat.getAttribute('aria-label')).toBe('Seat 3: Player Arriving');
    expect(container.querySelector('img')).toBeNull();
    expect(seat.textContent).toBe('');
  });

  it('a hidden chair with nothing arriving still draws nothing', () => {
    const { container } = render(
      <SeatSlot seatNumber={3} player={null} canSit={false} hideEmptyChair />
    );
    expect(container.querySelector('.seat--empty-hidden')).not.toBeNull();
    expect(container.querySelector('.seat--arriving')).toBeNull();
  });

  it('fades in at the player Animation Speed (CLAUDE.md 10.6)', () => {
    const css = readFileSync('src/components/table/SeatSlot.css', 'utf8');
    expect(css).toMatch(/seatArrivingIn calc\(0\.32s \* var\(--animation-speed, 1\)\)/);
  });

  it('the table passes the arriving set to every chair', () => {
    const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
    expect(page).toContain('arriving={lightningArrivingSeatSet.has(seatNumber)}');
  });
});
