import { afterEach, expect, test, vi } from 'vitest';
import { restingActionBox, restingAvatarBox } from '../../src/components/table/avatarCrownBounds';
import { wagerBoxesOverlap } from '../../src/lib/protectedWagerPlacement';
import { readFileSync } from 'node:fs';
const final = new DOMRect(210.8359375, 575.5093994140625, 58.328125, 15);
const bet = new DOMRect(220.0546875, 550.2281494140625, 39.890625, 28.28125);
const css = readFileSync('src/components/table/SeatSlot.css', 'utf8');
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function badge(pose: number, scale = 1, translate = 'none') {
  const seat = document.createElement('div');
  seat.className = 'seat seat--hero';
  const action = document.createElement('div');
  action.className = 'seat__action seat__action--call';
  seat.append(action);
  document.body.append(seat);
  const tx = translate === 'none' ? 0 : parseFloat(translate);
  const ty = translate === 'none' ? 0 : parseFloat(translate.split(' ')[1]);
  const w = final.width / scale,
    h = final.height / scale;
  Object.defineProperties(seat, {
    clientWidth: { value: 100 },
    clientHeight: { value: 80 },
    clientLeft: { value: 0 },
    clientTop: { value: 0 },
  });
  Object.defineProperties(action, {
    offsetParent: { value: seat },
    offsetWidth: { value: Math.round(w) },
    offsetHeight: { value: Math.round(h) },
    offsetLeft: { value: 50 },
    offsetTop: { value: -26 },
  });
  seat.getBoundingClientRect = () =>
    new DOMRect(
      final.left - (50 - w / 2 + tx) * scale,
      final.top - (-26 + ty) * scale,
      100 * scale,
      80 * scale
    );
  // Actual authored keyframe poses, applied to native failure's permanent box.
  const s = pose === 0 ? 0.5 : pose === 0.6 ? 1.1 : 1,
    dy = pose === 0 ? 8 : pose === 0.6 ? -2 : 0;
  action.getBoundingClientRect = () =>
    new DOMRect(
      final.left + w * (1 - s) * 0.5 * scale,
      final.top + (h * (1 - s) * 0.5 + dy * s) * scale,
      w * s * scale,
      h * s * scale
    );
  vi.stubGlobal('getComputedStyle', (e: Element) =>
    e === action
      ? {
          width: `${w}px`,
          height: `${h}px`,
          left: '50%',
          top: '-26px',
          translate,
          transform: `matrix(${s},0,0,${s},${-w / 2},${dy * s})`,
        }
      : {}
  );
  return action;
}
test('native 480/9-seat candidate: old animated reader admits the 3px resting collision', () => {
  expect(css).toContain('translateX(-50%) scale(0.5) translateY(8px)');
  expect(css).toContain('translateX(-50%) scale(1.1) translateY(-2px)');
  expect(css).toContain('translateX(-50%) scale(1) translateY(0)');
  const action = badge(0);
  expect(wagerBoxesOverlap(bet, restingAvatarBox(action, 1))).toBe(false); // Existing fallback admits it.
  expect(bet.bottom - final.top).toBe(3);
  expect(wagerBoxesOverlap(bet, final)).toBe(true);
  const keepout = restingActionBox(action, 1);
  // Same production collision predicate must reject this unsafe native candidate
  // before it becomes landed. Retaining landed wagers is deliberately unchanged.
  expect(wagerBoxesOverlap(bet, keepout)).toBe(true);
});
for (const pose of [0, 0.6, 1])
  for (const scale of [1, 0.8])
    test(`permanent projection pose ${pose}, table scale ${scale}, permanent shift retained`, () => {
      const action = badge(pose, scale, '3px -4px');
      const b = restingActionBox(action, scale);
      expect([b.left, b.top, b.width, b.height]).toEqual([
        final.left,
        final.top,
        final.width,
        final.height,
      ]);
    });
