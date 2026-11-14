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

it('rejects a lower-right nine-seat player drawn inward beside the middle-right player', () => {
  mount(RING);
  const table = document.querySelector<HTMLElement>('.table-page')!;
  table.dataset.seats = '9';
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const seat = table.querySelector<HTMLElement>('[data-seat-num="6"]')!;
  seat.parentElement!.dataset.box = seat.dataset.box;
  expect(readMobileTableLayout({}).violations).not.toContain(
    'Chair 6 Left Its Nine-Max Rail Anchor'
  );
  seat.dataset.box = '370,545,80,100';
  expect(readMobileTableLayout({}).violations).toContain('Chair 6 Left Its Nine-Max Rail Anchor');
});

it('refuses a top nine-seat portrait that extends down onto the table', () => {
  mount(RING);
  const table = document.querySelector<HTMLElement>('.table-page')!;
  table.dataset.seats = '9';
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const seat = table.querySelector<HTMLElement>('[data-seat-num="2"]')!;
  const wrapper = seat.parentElement!;
  wrapper.classList.add('seat-wrapper--cap');
  wrapper.dataset.box = seat.dataset.box;
  seat.innerHTML = '<div class="seat__info" data-box="120,128,84,30"></div>';
  const violation = 'Chair 2 Top Portrait Inside Nine-Max Table';
  expect(readMobileTableLayout({}).violations).toContain(violation);
  seat.querySelector<HTMLElement>('.seat__info')!.dataset.box = '120,100,84,30';
  expect(readMobileTableLayout({}).violations).not.toContain(violation);
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

it('live verification refuses a caption behind the header', () => {
  mount(RING);
  (document.querySelector('.table-page') as HTMLElement).dataset.seats = '9';
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="multi-table-page__tab-bar-wrapper" data-box="0,0,600,80"></div>'
  );
  document.querySelector('.seat')!.innerHTML =
    '<div class="seat__action" data-box="100,70,60,20">Fold</div>';
  expect(readMobileTableLayout({}).violations).toContain(
    'Action Caption Outside Playable Viewport'
  );
  (document.querySelector('.seat__action') as HTMLElement).dataset.box = '100,81,60,20';
  expect(readMobileTableLayout({}).violations).not.toContain(
    'Action Caption Outside Playable Viewport'
  );
});

it.each(['away', 'sitting_out'])('live verification refuses clipped %s portraits', (status) => {
  mount(RING);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const seat = document.querySelector<HTMLElement>('.seat')!;
  seat.classList.add(`seat--${status}`);
  seat.style.cssText = 'opacity:0.55;filter:none';
  seat.innerHTML =
    '<div class="seat__avatar-wrap" style="opacity:1;filter:none"><div class="seat__avatar seat__avatar--bust" data-box="100,100,80,80" style="opacity:1;filter:grayscale(0.6)"></div></div>';
  const violation = 'Inactive Portrait Has A Clipping Compositing Group';
  expect(readMobileTableLayout({}).violations).toContain(violation);
  seat.style.opacity = '1';
  expect(readMobileTableLayout({}).violations).toContain(violation);
  seat.querySelector<HTMLElement>('.seat__avatar')!.style.filter = 'none';
  expect(readMobileTableLayout({}).violations).not.toContain(violation);
});

it.each(['winner', 'dim', 'winner-dim'])(
  'live verification refuses clipped %s portraits',
  (state) => {
    mount(RING);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const table = document.querySelector('.table-page')!;
    const seat = document.querySelector<HTMLElement>('.seat')!;
    const wrapper = seat.closest<HTMLElement>('.seat-wrapper')!;
    table.classList.toggle('table-page--winner-flash', state.includes('winner'));
    wrapper.classList.toggle('seat-wrapper--dim', state.includes('dim'));
    wrapper.style.cssText = 'opacity:1;filter:none';
    seat.style.cssText = 'opacity:1;filter:none';
    seat.innerHTML =
      '<div class="seat__avatar-wrap" style="opacity:1;filter:brightness(0.73)"><div class="seat__avatar seat__avatar--bust" data-box="100,100,80,80" style="opacity:1;filter:none"><img class="seat__avatar-img" style="filter:brightness(0.73) brightness(0.85) saturate(0.9);opacity:0.78"></div></div>';
    const violation = 'Celebration Or Dim Portrait Has A Clipping Compositing Group';
    expect(readMobileTableLayout({}).violations).toContain(violation);
    seat.querySelector<HTMLElement>('.seat__avatar-wrap')!.style.filter = 'none';
    seat.style.opacity = '0.78';
    expect(readMobileTableLayout({}).violations).toContain(violation);
    seat.style.opacity = '1';
    expect(readMobileTableLayout({}).violations).not.toContain(violation);
  }
);

it('live verification refuses folded seat opacity even when its avatar wrapper is clear', () => {
  mount(RING);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const seat = document.querySelector<HTMLElement>('.seat')!;
  seat.classList.add('seat--folded');
  seat.style.cssText = 'opacity:0.75;filter:none';
  seat.innerHTML =
    '<div class="seat__avatar-wrap" data-box="100,100,80,80" style="opacity:1;filter:none"><div class="seat__avatar seat__avatar--bust"><img style="opacity:0.4875;filter:brightness(0.73) brightness(0.8) saturate(0.55)"></div></div>';
  const violation = 'Folded Portrait Has A Clipping Compositing Group';
  expect(readMobileTableLayout({}).violations).toContain(violation);
  seat.style.opacity = '1';
  expect(readMobileTableLayout({}).violations).not.toContain(violation);
});
