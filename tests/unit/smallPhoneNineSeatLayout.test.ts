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
  it.each([375, 393, 430])('keeps side chairs stable and top panels apart at %spx', (width) => {
    const ring = fitted(width, 9);
    for (let i = 0; i < ring.length; i++) {
      const raw = seatLayoutFor(9)[i];
      const pod = seatPodPx(width, raw.y === 100, canvas.w, { seats: 9, canvasHeightPx: canvas.h });
      if (raw.y === 100 || raw.y === 58)
        expect(ring[i]).toEqual(fitSeatToViewport(raw, canvas, width, pod));
      if (raw.y === 25) expect(ring[i].y).toBe(22);
      if (raw.y === 82.5) expect(ring[i].y).toBe(90);
    }
    const caps = ring.filter((seat) => seat.y < 20);
    const panel = seatPodPx(width, false, canvas.w, { seats: 9, canvasHeightPx: canvas.h });
    expect(((caps[1].x - caps[0].x) * canvas.w) / 100).toBeGreaterThanOrEqual(panel.w + 3);
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

// The owner identified visual seat pairs in a full-table mobile screenshot.
// Rotation may change the aliases in those positions; geometry must not.
describe('full portrait seat pair placement', () => {
  it.each([
    [393, 322, 570, undefined, 90],
    [604, 604, 1020, undefined, 98],
    [393, 393, 660, 0, 98],
  ])(
    'raises upper sides and lowers corners at %spx without moving hero/middle',
    (width, w, h, portraitTaper, lowerY) => {
      const canvas = { w, h, portraitTaper };
      const fitted = seatLayoutFor(9).map((seat) =>
        fitSeatToViewport(
          seat,
          canvas,
          width,
          seatPodPx(width, seat.y === 100, w, { seats: 9, canvasHeightPx: h }),
          (width - w) / 2,
          9
        )
      );
      expect(fitted[3].y).toBe(22);
      expect(fitted[6].y).toBe(22);
      expect(fitted[1].y).toBe(lowerY);
      expect(fitted[8].y).toBe(lowerY);
      expect(fitted[0]).toEqual({ x: 50, y: 100 });
      expect(fitted[2].y).toBe(width > 480 || portraitTaper === 0 ? 67 : 54);
      expect(fitted[7].y).toBe(fitted[2].y);
    }
  );
});
