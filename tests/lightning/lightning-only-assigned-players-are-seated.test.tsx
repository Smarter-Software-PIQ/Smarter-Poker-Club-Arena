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
