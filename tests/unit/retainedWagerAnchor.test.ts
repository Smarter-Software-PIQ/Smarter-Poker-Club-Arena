import { expect, it } from 'vitest';
import {
  retainedWagerCorrection,
  wagerAnchor,
  wagerRestPoint,
} from '../../src/lib/retainedWagerAnchor';

it('retains the chip tower base rather than its changing label envelope', () => {
  const canvas = { left: 0, top: 0, width: 400, height: 700 };
  const bet = document.createElement('div');
  const stacks = document.createElement('div');
  stacks.className = 'cp-stacks';
  stacks.style.transform = 'translateX(-30px) scale(0.65)';
  bet.append(stacks);
  for (const [key, value] of Object.entries({
    offsetParent: bet,
    offsetLeft: 0,
    offsetTop: 2,
    offsetWidth: 24,
    offsetHeight: 30,
  }))
    Object.defineProperty(stacks, key, { value, configurable: true });
  const point = wagerRestPoint(bet)!;
  expect(point).toEqual({ x: 12, y: 32 });
  const anchor = wagerAnchor({ left: 100, top: 200, width: 60, height: 35 }, canvas, 1, point);
  // Larger label widens the marker and more chips grow the tower upward.
  Object.defineProperty(stacks, 'offsetHeight', { value: 42 });
  const changed = { left: 80, top: 194, width: 100, height: 47 };
  const correction = retainedWagerCorrection(anchor, changed, canvas, 1, wagerRestPoint(bet));
  expect(correction).toEqual({ x: 20, y: -6 });
  expect(
    wagerAnchor(
      { ...changed, left: changed.left + correction.x, top: changed.top + correction.y },
      canvas,
      1,
      wagerRestPoint(bet)
    )
  ).toEqual(anchor);
});

it('keeps a landed contribution centre through amount and all-in group geometry changes', () => {
  const canvas = { left: 40, top: 90, width: 400, height: 700 };
  const landed = { left: 160, top: 300, width: 30, height: 20 };
  const anchor = wagerAnchor(landed, canvas, 0.5);
  // A wider amount label and a new all-in flex sibling move the inherited
  // outer marker. The chip children's slide/collect transforms are excluded.
  const changed = { left: 180, top: 310, width: 50, height: 24 };
  const correction = retainedWagerCorrection(anchor, changed, canvas, 0.5);
  expect(correction).toEqual({ x: -60, y: -24 });
  const restored = {
    ...changed,
    left: changed.left + correction.x * 0.5,
    top: changed.top + correction.y * 0.5,
  };
  expect(wagerAnchor(restored, canvas, 0.5)).toEqual(anchor);
  expect(retainedWagerCorrection(anchor, restored, canvas, 0.5)).toEqual({ x: 0, y: 0 });
  // Collection delta receives the inverse correction, preserving its endpoint.
  expect(restored.left + restored.width / 2 + (80 - correction.x) * 0.5).toBe(
    changed.left + changed.width / 2 + 80 * 0.5
  );
});

it('tracks table translation without relocating its retained felt anchor', () => {
  const canvas = { left: 10, top: 20, width: 400, height: 700 };
  const box = { left: 100, top: 200, width: 20, height: 20 };
  const anchor = wagerAnchor(box, canvas, 1);
  expect(retainedWagerCorrection(anchor, { ...box, top: 230 }, { ...canvas, top: 50 }, 1)).toEqual({
    x: 0,
    y: 0,
  });
});
