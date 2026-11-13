// The live phone-table check (tests/e2e/support/mobileLiveTableLayout.ts)
// must catch a chair drawn out of its seat. Dan 2026-11-05: Mongo's BigWade
// drawn below Cali_Duncan, and Danimal's right-hand chairs collapsed onto the
// left-hand ones. Correct rings must pass.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readMobileTableLayout } from '../e2e/support/mobileLiveTableLayout';

// 9-max ring rotated for a hero in seat 7 (Danimal's table): seat -> [x%, y%].
const RING: Record<number, [number, number]> = {
  7: [50, 100],
  8: [9.5, 80],
  9: [9.5, 52],
  1: [9.5, 25],
  2: [27, 6],
  3: [73, 6],
  4: [90.5, 25],
  5: [90.5, 52],
  6: [90.5, 80],
};

function mount(ring: Record<number, [number, number]>) {
  document.body.innerHTML = `<div class="table-page" data-box="0,0,600,1200"><div class="table-scaler" data-box="0,100,600,900">${Object.entries(
    ring
  )
    .map(
      ([n, [x, y]]) =>
        `<div class="seat-wrapper"><div class="seat" data-seat-num="${n}" data-box="${(x / 100) * 600 - 40},${100 + (y / 100) * 900 - 50},80,100"></div></div>`
    )
    .join('')}</div></div>`;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? '')
      .split(',')
      .map(Number);
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const chairViolations = () =>
  readMobileTableLayout({}).violations.filter((v: string) => /^Chairs /.test(v));

it('a correct ring passes', () => {
  mount(RING);
  expect(chairViolations()).toEqual([]);
});

it("Danimal's collapse is caught: every chair right of 30% pinned at 29.7%", () => {
  const collapsed = { ...RING };
  for (const n of [3, 4, 5, 6, 7]) collapsed[n] = [29.7, RING[n][1]];
  mount(collapsed);
  expect(chairViolations().length).toBeGreaterThan(0);
});

it("Mongo's BigWade is caught: one chair parked below its neighbour", () => {
  const moved = { ...RING };
  moved[1] = [9.5, 95];
  mount(moved);
  expect(chairViolations().length).toBeGreaterThan(0);
});

it('two chairs drawn on one spot are caught', () => {
  const stacked = { ...RING };
  stacked[4] = [...RING[5]];
  mount(stacked);
  expect(chairViolations().some((v: string) => /On One Spot/.test(v))).toBe(true);
});

it('live verification refuses action captions over cards or player plates', () => {
  mount(RING);
  (document.querySelector('.table-page') as HTMLElement).dataset.seats = '9';
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const seat = document.querySelector('.seat')!;
  seat.innerHTML =
    '<div class="seat__action" data-box="100,100,60,20">Call</div><div class="seat__cards"><div class="seat__card" data-box="110,105,30,40"></div></div><div class="seat__info" data-box="100,115,90,40"></div>';
  const read = () =>
    readMobileTableLayout({}).violations.filter((v: string) =>
      v.startsWith('Action Caption Covers')
    );
  expect(read()).toHaveLength(2);
  (seat.querySelector('.seat__action') as HTMLElement).dataset.box = '100,70,60,20';
  expect(read()).toEqual([]);
});
