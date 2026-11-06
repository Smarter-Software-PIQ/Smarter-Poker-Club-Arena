/**
 * LAW: a chair is never capped by a moving table (Dan 2026-11-05, Danimal's
 * phone, Afternoon Free Buy Table 9: "THE AVATARS POSITION ... NEVER EVER EVER
 * BE ABLE TO CHANGE DURING LIVE PLAY").
 *
 * The engine had every seat right (1 msp_diego ... 9 kickermoose, hero 7).
 * On his phone every chair right of ~30% of the felt (KenjiJAX, RaySA, the
 * empty seat 5, PVDHank and Danimal himself) was drawn on top of the
 * left-hand chairs. `fitSeatToViewport` keeps pods on screen, and TablePage
 * passed it the scaler's PAINTED left edge (`getBoundingClientRect().left`).
 * A table caught mid-slide, mid-zoom or mid-scroll reported a left edge of
 * ~360px, the clamp pinned every right-hand chair at maxX ~30%, and the
 * memoized ring kept it after the table came to rest. Reproduced live by
 * shifting the table slot 360px during one re-fit.
 *
 * Root fix: the left edge is read from LAYOUT offsets (`scalerLayoutLeftPx`).
 * Failsafe: a window that does not contain the table's own centre is refused,
 * so no measurement can ever move a chair across the table.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEAT_LAYOUTS } from '../src/lib/tableSeatGeometry';
import { fitSeatToViewport, seatPodPx } from '../src/components/table/tableGeometry';

const side = (x: number) => (x < 50 ? -1 : x > 50 ? 1 : 0);

describe('a chair is never capped by a moving table', () => {
  it("Danimal's frame: a 360px slide no longer pins the right-hand chairs at 30%", () => {
    // His phone: 600px layout viewport, 598px felt, measured left edge 361.
    const canvas = { w: 598, h: 954 };
    for (const seat of SEAT_LAYOUTS[9]) {
      const pod = seatPodPx(600, seat.y >= 100 && seat.x === 50, canvas.w, {
        seats: 9,
        canvasHeightPx: canvas.h,
      });
      const fitted = fitSeatToViewport(seat, canvas, 600, pod, 361, 9);
      expect(fitted).toBe(seat);
    }
  });

  for (const width of [320, 375, 393, 430, 600, 784, 1024, 1440])
    it(`at ${width}px, no left edge can move any chair into the other half of the table`, () => {
      const canvasW = Math.min(width, 600) - 2;
      const canvas = { w: canvasW, h: (canvasW * 1000) / 605 };
      for (const [size, ring] of Object.entries(SEAT_LAYOUTS))
        for (const seat of ring)
          for (let left = -width; left <= width; left += 7) {
            const pod = seatPodPx(width, seat.y >= 100 && seat.x === 50, canvas.w, {
              seats: Number(size),
              canvasHeightPx: canvas.h,
            });
            const fitted = fitSeatToViewport(seat, canvas, width, pod, left, Number(size));
            expect(side(fitted.x)).toBe(side(seat.x));
          }
    });

  it('TablePage reads the left edge from layout, never from paint', () => {
    const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
    const block = source.slice(
      source.indexOf('const seatPositions = useMemo('),
      source.indexOf('seatPositionsRef.current = seatPositions')
    );
    expect(source).toContain('scalerLayoutLeftPx(tableScalerRef.current)');
    expect(block).not.toMatch(/getBoundingClientRect/);
    expect(block).toMatch(/canvasLeftPx\]\);/);
  });
});
