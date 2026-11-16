import { describe, expect, it } from 'vitest';
import { fitSeatToViewport, seatPodPx } from '../../src/components/table/tableGeometry';
import { seatLayoutFor } from '../../src/lib/tableSeatGeometry';

describe('nine-seat lanes on a 320px phone', () => {
  const canvas = { w: 262.4, h: 324 };
  const fitted = (width: number, count: number) =>
    seatLayoutFor(count).map((seat) =>
      fitSeatToViewport(
        seat,
        canvas,
        width,
        seatPodPx(width, seat.y === 100, canvas.w, { seats: count, canvasHeightPx: canvas.h }),
        (width - canvas.w) / 2,
        count
      )
    );
  it('leaves room for the whole avatar, plate and action above each side chair', () => {
    const seats = fitted(320, 9);
    for (const side of [seats.filter((p) => p.x < 20), seats.filter((p) => p.x > 80)]) {
      const ys = side.map((p) => (p.y * canvas.h) / 100).sort((a, b) => a - b);
      expect(ys).toHaveLength(3);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(92);
    }
  });
  it('keeps the two cap players inboard of the three-chair side columns', () => {
    const caps = fitted(320, 9).filter((p) => p.y < 20);
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      const x = (320 - canvas.w) / 2 + (cap.x * canvas.w) / 100;
      expect(x - 29).toBeGreaterThan(72);
      expect(x + 29).toBeLessThan(248);
    }
  });
  it.each([375, 393, 430])('preserves the existing wider phone ring at %spx', (width) => {
    for (const seat of seatLayoutFor(9)) {
      const pod = seatPodPx(width, seat.y === 100, canvas.w, {
        seats: 9,
        canvasHeightPx: canvas.h,
      });
      expect(fitSeatToViewport(seat, canvas, width, pod, undefined, 9)).toEqual(
        fitSeatToViewport(seat, canvas, width, pod)
      );
    }
  });
  it('preserves the six-seat ring', () => {
    for (const seat of seatLayoutFor(6)) {
      const pod = seatPodPx(320, seat.y === 100, canvas.w);
      expect(fitSeatToViewport(seat, canvas, 320, pod, undefined, 6)).toEqual(
        fitSeatToViewport(seat, canvas, 320, pod)
      );
    }
  });
});

describe('nine-seat full-game phone canvas', () => {
  it.each([0, 0.25])(
    'keeps side chairs on the table when page gutters widen (taper %s)',
    (portraitTaper) => {
      const sides = seatLayoutFor(9).filter((seat) => seat.y >= 20 && seat.y < 100);
      expect(sides).toHaveLength(6);
      for (const seat of sides) {
        const canvas = { w: 450, h: 630, portraitTaper };
        const pod = seatPodPx(600, false, canvas.w, { seats: 9, canvasHeightPx: canvas.h });
        const fitted = fitSeatToViewport(seat, canvas, 600, pod, 75, 9);
        const distanceFromSide = Math.min(fitted.x, 100 - fitted.x);
        expect(distanceFromSide).toBeGreaterThanOrEqual(seat.y === 82.5 ? 7 : 3.5);
        expect(distanceFromSide).toBeLessThan(16);
      }
    }
  );
  it('reserves the enlarged nine-seat hero diameter in marker geometry', () => {
    const hero = seatPodPx(600, true, 500, { seats: 9, canvasHeightPx: 720 });
    expect(hero.w).toBeGreaterThanOrEqual((((500 * 0.158 * 4) / 3) * 8) / 7 - 0.01);
  });
});
