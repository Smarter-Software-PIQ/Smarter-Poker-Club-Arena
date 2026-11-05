/**
 * THE CHAIRS NEVER CHANGE ORDER (Dan 2026-11-05)
 *
 * Mongo, PLO8 Morning Stack - Table 1, hands #55414869 / #55415924 / #55416829.
 * The engine, the hand history and the seat rows all had
 *
 *   1 sixesquads9 · 2 Mongo · 3 Cali_Duncan · 4 BUTTONCHAMP · 5 BigWade · 6 raypatel ...
 *
 * but Mongo's phone drew BigWade in the bottom-left corner, BELOW Cali_Duncan,
 * with the left-high chair (seat 5's real spot) standing empty. The action
 * order looked broken to everyone at the table: BigWade "still acts when he
 * should of he was in the other seat".
 *
 * The opponent-spacing allocator had carried seat 5's avatar down past its
 * neighbours. These tests pin the law that forbids it at both enforcement
 * points: the joint solver never returns a layout that reorders the ring, and
 * the DOM backstop withdraws any nudge that does.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createOpponentAvatarLayout,
  jointOpponentShifts,
  opponentRingOrderKept,
  type ChairPoint,
} from '../src/components/table/opponentAvatarLayout';

type Box = { left: number; top: number; width: number; height: number };
const centreOf = (parts: Box[]): ChairPoint => {
  const left = Math.min(...parts.map((p) => p.left));
  const top = Math.min(...parts.map((p) => p.top));
  const right = Math.max(...parts.map((p) => p.left + p.width));
  const bottom = Math.max(...parts.map((p) => p.top + p.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
};

/* Mongo's 9-max phone ring as drawn (CSS px inside a 375 x 860 table), in seat
   order 1..9 with the hero (seat 2) at the bottom centre. */
const RING: Record<string, ChairPoint> = {
  sixesquads9: { x: 330, y: 650 }, // 1 lower-right
  Mongo: { x: 188, y: 800 }, // 2 hero
  Cali_Duncan: { x: 46, y: 650 }, // 3 lower-left
  BUTTONCHAMP: { x: 40, y: 470 }, // 4 left-low
  BigWade: { x: 40, y: 250 }, // 5 left-high
  raypatel: { x: 100, y: 90 }, // 6 top-left
  champp: { x: 275, y: 90 }, // 7 top-right
  king_01: { x: 335, y: 250 }, // 8 right-high
  EMPTY: { x: 335, y: 470 }, // 9 right-low
};
const names = Object.keys(RING);
const rails = names.map((n) => RING[n]);
const CENTRE = { x: 188, y: 430 };

describe('opponentRingOrderKept', () => {
  it('accepts the rail itself and ordinary spacing nudges', () => {
    expect(opponentRingOrderKept(rails, rails, CENTRE)).toBe(true);
    const nudged = rails.map((p, i) => ({ x: p.x + (i % 2 ? 4 : -6), y: p.y + (i % 3) * 12 }));
    expect(opponentRingOrderKept(rails, nudged, CENTRE)).toBe(true);
  });

  it("refuses Mongo's frame: seat 5 drawn below seat 3 in the corner", () => {
    const frame = rails.map((p, i) => (names[i] === 'BigWade' ? { x: 46, y: 830 } : p));
    expect(opponentRingOrderKept(rails, frame, CENTRE)).toBe(false);
  });

  it('refuses any single chair carried past its neighbour', () => {
    const swapped = rails.map((p, i) =>
      names[i] === 'BigWade' ? { x: 40, y: 520 } : p
    ); // now below BUTTONCHAMP (470)
    expect(opponentRingOrderKept(rails, swapped, CENTRE)).toBe(false);
  });

  it('allows two neighbouring caps to slide sideways together (the 320px ring)', () => {
    const caps = rails.map((p, i) =>
      names[i] === 'raypatel'
        ? { x: p.x - 4, y: p.y }
        : names[i] === 'champp'
          ? { x: p.x - 52, y: p.y - 47 }
          : p
    );
    expect(opponentRingOrderKept(rails, caps, CENTRE)).toBe(true);
  });

  it('never accepts a non-finite position', () => {
    const bad = rails.map((p, i) => (i === 4 ? { x: Number.NaN, y: p.y } : p));
    expect(opponentRingOrderKept(rails, bad, CENTRE)).toBe(false);
  });
});

describe('the joint spacing solver never reorders the ring', () => {
  const bounds = { left: 2, top: 60, width: 371, height: 860 };
  const pod = (c: ChairPoint, w = 92, h = 150): Box[] => [
    { left: c.x - w / 2, top: c.y - h / 2, width: w, height: h },
  ];

  it('never returns a layout that carries a left-column chair past a neighbour', () => {
    // An obstruction across seat 5's own rail spot makes "move" mandatory, and
    // the page's bottom edge is among its candidates.
    const fixed = [{ left: 0, top: 160, width: 140, height: 180 }];
    const items = [
      { parts: pod(RING.BigWade), side: -1, outwardOnly: true },
      { parts: pod(RING.BUTTONCHAMP), side: -1, outwardOnly: true },
      { parts: pod(RING.Cali_Duncan), side: -1, outwardOnly: true },
    ];
    const others = [RING.Mongo, RING.raypatel, RING.champp, RING.king_01, RING.EMPTY];
    const before = [...others, ...items.map((item) => centreOf(item.parts))];
    for (const [gap, close] of [
      [3, false],
      [0.5, true],
      [0, true],
    ] as const) {
      const shifts = jointOpponentShifts(
        items,
        fixed,
        bounds,
        gap,
        close,
        undefined,
        undefined,
        others
      );
      if (!shifts) continue; // refusing is allowed; reordering is not
      const after = [
        ...others,
        ...items.map((item, i) => {
          const c = centreOf(item.parts);
          return { x: c.x + shifts[i][0], y: c.y + shifts[i][1] };
        }),
      ];
      expect(opponentRingOrderKept(before, after, { x: 187.5, y: 490 })).toBe(true);
    }
  });

  it('holds the law on every solution for many random dense columns', () => {
    let seed = 20261105;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let trial = 0; trial < 60; trial++) {
      const ys = [180 + rand() * 120, 420 + rand() * 120, 640 + rand() * 80];
      const items = ys.map((y) => ({
        parts: pod({ x: 40 + rand() * 20, y }, 80 + rand() * 40, 120 + rand() * 60),
        side: -1,
        outwardOnly: true,
      }));
      const fixed = [
        { left: 0, top: 100 + rand() * 600, width: 60 + rand() * 120, height: 40 + rand() * 160 },
      ];
      const others = [RING.Mongo, RING.champp, RING.king_01];
      const before = [...others, ...items.map((item) => centreOf(item.parts))];
      const shifts = jointOpponentShifts(
        items,
        fixed,
        bounds,
        3,
        rand() > 0.5,
        undefined,
        undefined,
        others
      );
      if (!shifts) continue;
      const after = [
        ...others,
        ...items.map((item, i) => {
          const c = centreOf(item.parts);
          return { x: c.x + shifts[i][0], y: c.y + shifts[i][1] };
        }),
      ];
      expect(opponentRingOrderKept(before, after, { x: 187.5, y: 490 })).toBe(true);
    }
  });
});

describe('the DOM backstop withdraws a nudge that reorders the table', () => {
  const build = (shifts: Record<string, [number, number]>) => {
    const page = document.createElement('div');
    page.className = 'table-page';
    const scaler = document.createElement('div');
    scaler.className = 'table-scaler';
    scaler.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 375, height: 860, right: 375, bottom: 860, x: 0, y: 0 }) as DOMRect;
    page.append(scaler);
    document.body.append(page);
    const seatOf = new Map<string, HTMLElement>();
    for (const name of names) {
      const at = RING[name];
      const hero = name === 'Mongo';
      const wrapper = document.createElement('div');
      wrapper.className = `seat-wrapper${hero ? ' seat-wrapper--hero' : ''}`;
      const seat = document.createElement('div');
      seat.className = `seat${hero ? ' seat--hero' : ''}${name === 'EMPTY' ? ' seat--empty' : ''}`;
      const shift = shifts[name];
      if (shift) {
        seat.style.setProperty('--sp-opponent-x', `${shift[0]}px`);
        seat.style.setProperty('--sp-opponent-y', `${shift[1]}px`);
      }
      const rect = {
        left: at.x - 40,
        top: at.y - 60,
        width: 80,
        height: 120,
        right: at.x + 40,
        bottom: at.y + 60,
        x: at.x - 40,
        y: at.y - 60,
        toJSON: () => ({}),
      } as DOMRect;
      wrapper.getBoundingClientRect = () => rect;
      seat.getBoundingClientRect = () => rect;
      wrapper.append(seat);
      scaler.append(wrapper);
      seatOf.set(name, seat);
    }
    const layout = createOpponentAvatarLayout(
      scaler,
      page,
      { key: '', shifts: new WeakMap() },
      vi.fn()
    );
    return { page, layout, seatOf };
  };

  it("puts Mongo's table back on its rails", () => {
    const { page, layout, seatOf } = build({ BigWade: [6, 580], Cali_Duncan: [0, -8] });
    try {
      layout.space();
      for (const seat of seatOf.values()) {
        expect(parseFloat(seat.style.getPropertyValue('--sp-opponent-x') || '0')).toBe(0);
        expect(parseFloat(seat.style.getPropertyValue('--sp-opponent-y') || '0')).toBe(0);
      }
    } finally {
      layout.stop();
      page.remove();
    }
  });

  it('leaves ordinary spacing alone', () => {
    const { page, layout, seatOf } = build({ BigWade: [0, 30], Cali_Duncan: [0, -8] });
    try {
      layout.space();
      expect(seatOf.get('BigWade')!.style.getPropertyValue('--sp-opponent-y')).toBe('30px');
      expect(seatOf.get('Cali_Duncan')!.style.getPropertyValue('--sp-opponent-y')).toBe('-8px');
    } finally {
      layout.stop();
      page.remove();
    }
  });
});
