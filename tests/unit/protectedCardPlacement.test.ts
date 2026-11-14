import { describe, expect, it } from 'vitest';
import {
  placeProtectedCardRow,
  placeHiddenFans,
  type CardBox,
} from '../../src/lib/protectedCardPlacement';
const overlap = (a: CardBox, b: CardBox) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;
describe('revealed cards leave boards and totals clear', () => {
  for (const width of [320, 375, 393, 430, 768, 1440]) {
    for (const boards of [1, 2, 3]) {
      it(`${width}px, ${boards} boards: protects both runs, totals and player boxes`, () => {
        const bounds = { left: 0, top: 0, width, height: 852 };
        const protectedBoxes: CardBox[] = [
          { left: width * 0.2, top: 300, width: width * 0.6, height: 70 * boards },
          { left: width * 0.35, top: 240, width: width * 0.3, height: 48 },
          { left: 0, top: 420, width: width * 0.23, height: 40 },
        ];
        const row = { left: width * 0.08, top: 360, width: width * 0.23, height: 32 };
        const placed = placeProtectedCardRow(row, protectedBoxes, bounds);
        expect(placed).not.toBeNull();
        expect(protectedBoxes.every((box) => !overlap(placed!, box))).toBe(true);
        expect(placed!.width).toBe(row.width);
        expect(placed!.left).toBeGreaterThanOrEqual(0);
        expect(placed!.left + placed!.width).toBeLessThanOrEqual(width);
      });
    }
  }
  it('leaves an already clear hand beside its own seat', () => {
    const row = { left: 10, top: 30, width: 80, height: 32 };
    expect(placeProtectedCardRow(row, [], { left: 0, top: 0, width: 393, height: 852 })).toEqual(
      row
    );
  });
});

it('moves the closed fan clear of the adjacent plate on the recorded 390px ring', () => {
  const page = document.createElement('div');
  page.innerHTML =
    '<div class="seat__info"></div><div class="seat__cards--opponent"><div class="seat__card"></div></div>';
  const plate = page.querySelector<HTMLElement>('.seat__info')!;
  const fan = page.querySelector<HTMLElement>('.seat__cards--opponent')!;
  const card = fan.firstElementChild!;
  plate.getBoundingClientRect = () => new DOMRect(364.65625, 253.35365, 96, 36);
  card.getBoundingClientRect = () =>
    new DOMRect(
      458.84879 + (parseFloat(fan.style.getPropertyValue('--sp-fan-clear-x')) || 0),
      280.08221,
      13.05993,
      18.68244
    );
  const bounds = new DOMRect(0, 0, 600, 1021);
  expect(overlap(card.getBoundingClientRect(), plate.getBoundingClientRect())).toBe(true);
  placeHiddenFans(page, page, bounds, 1);
  expect(card.getBoundingClientRect().left - plate.getBoundingClientRect().right).toBeCloseTo(0.5);
  const shift = fan.style.cssText;
  placeHiddenFans(page, page, bounds, 1);
  expect(fan.style.cssText).toBe(shift);
});
