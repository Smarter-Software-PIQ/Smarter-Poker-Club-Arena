/**
 * LAW: on a portrait phone or tablet, every top chair on every ring stands on
 * the rail. Never on the felt.
 *
 * Dan 2026-11-22, first of the six-max table: "THE TOP VILLAIN IS TO LOW ON
 * THE TABLE! THEY MUST 100% OF THE TIME BE ON THE RAIL AND NEVER ON TOP OF
 * THE TABLE OR OVERLAPPING THE FELT. THE TOP OF THAT VILLAINS HEAD CAN BE 'CUT
 * OFF' AT THE TOP OR 'UNDER THE ACTION BAR' WITH THE ACTION BAR BEING LAYER 1
 * AND THE AVATAR LAYER 2." Then, of every other table size that drew the same
 * chair on the felt: "FULLY BUILD, FIX AND ENHANCE ALL OF THESE".
 *
 * How it broke. Measured on the real components before this law (felt window
 * at 8.9% of the canvas), the top plate's bottom edge sat at 13.6-17.5% on
 * the heads-up, 3, 4, 5, 7 and 8 seat phone layouts (cash and tournament),
 * 13.5-29.1% on raw-width phones (<= 480px) for every ring including six-max
 * and nine-seat, and 12.4-18.6% on portrait tablets (641-768px). Three causes:
 *  1. useProtectedCardLayout placed those pods from the jackpot plate DOWN
 *     (crown 8px under the Mini BBJ) and paid for the rest with the plate.
 *  2. The chair allocator held the pod inside a box whose top is the tab bar.
 *  3. A tournament's top chairs carry no `--top` tag, so outside the six-max
 *     and nine-seat phone rings the layout hook never placed them at all.
 * Only the six-max (fixed earlier the same day) and nine-seat rings at the
 * 600px phone layout were on the rail.
 *
 * Every top chair is now placed from the RAIL UP (src/components/table/
 * topChairRail.ts): the plate's bottom edge rests on the chair's own rail
 * station (the nine-seat phone ring keeps its approved centred plates, never
 * past the felt), the allocator never nudges it, the size fitter lets its
 * portrait pass behind the tab bar instead of shrinking (CLAUDE.md 10.7c), and
 * the jackpot plaque and the tab bar paint above any crown that reaches them.
 * The browser guard (readMobileTableLayout, "Top Seat") proves the same on the
 * real components and in the post-deploy live proof.
 */
import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phoneReferenceLayout,
  stationIsOnTheTopRail,
  topChairRailShift,
  topChairRailViewport,
  topChairRest,
} from '../src/components/table/topChairRail';
import { FELT_WINDOW } from '../src/components/table/tableGeometry';
import { DRAWABLE_SEAT_RINGS, isTopCapSeat } from '../src/lib/tableSeatGeometry';
import { useProtectedCardLayout } from '../src/hooks/useProtectedCardLayout';
import { installCssTranslateShim } from './unit/support/cssTranslateShim';
import { sliceBetween, sliceMethod, sliceStatement } from './helpers/sourceWindow';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const RINGS = Object.keys(DRAWABLE_SEAT_RINGS).map(Number);

/** The canvas (`.table-scaler`, viewport px) of each width class the rule
 * covers, measured on the real components (2026-11-22), with the plate
 * heights measured there: 37.2 (7- to 10-seat rings), 43.4 / 47 / 48.35
 * (raw and phone heads-up to six-max), 53.6 (tournament plate). */
const CANVASES = [
  { name: '600x1298 phone layout (390x844)', ringTop: 205, ringHeight: 894.3 },
  { name: '600x1298 phone layout, six-max', ringTop: 312.3, ringHeight: 787 },
  { name: '600x1065 phone layout (320x568)', ringTop: 133, ringHeight: 791.5 },
  { name: '600x900 phone layout, toolbars showing', ringTop: 120, ringHeight: 590 },
  { name: 'raw 390x844', ringTop: 214, ringHeight: 401 },
  { name: 'raw 320x568', ringTop: 160, ringHeight: 300 },
  { name: 'tablet 768x1024', ringTop: 151, ringHeight: 717.7 },
] as const;
const PLATES = [37.2, 43.4, 47, 48.35, 53.6] as const;

describe('every top-cap station of every ring is on the rail', () => {
  it.each(RINGS)('%i seats', (seats) => {
    const tops = DRAWABLE_SEAT_RINGS[seats].filter((p) => isTopCapSeat(p.y));
    expect(tops.length, 'every ring of two or more has a top chair').toBeGreaterThan(0);
    for (const station of tops) {
      expect(stationIsOnTheTopRail(station.y)).toBe(true);
      expect(station.y).toBeLessThan(FELT_WINDOW.top);
    }
    // Two chairs on one top rail line share one station: level by construction.
    // (Only the ten-seat ring has two lines: its centre chair at y 5 and its
    // diagonals at y 6, the stations of the six- and five-seat rings.)
    for (const y of new Set(tops.map((p) => p.y)))
      expect(tops.filter((p) => p.y === y).length).toBeLessThanOrEqual(2);
    expect(new Set(tops.map((p) => p.y)).size).toBe(seats === 10 ? 2 : 1);
  });
});

describe('which layouts stand their top chairs on the rail', () => {
  it('every portrait phone and tablet up to 768px', () => {
    for (const [w, h] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [430, 932],
      [600, 900],
      [600, 1065],
      [600, 1298],
      [641, 900],
      [700, 1000],
      [744, 1133],
      [768, 1024],
    ])
      expect(topChairRailViewport(w, h), `${w}x${h}`).toBe(true);
  });
  it('not landscape and not wider than 768px', () => {
    for (const [w, h] of [
      [844, 390],
      [667, 375],
      [769, 1024],
      [1024, 1366],
      [1280, 800],
    ])
      expect(topChairRailViewport(w, h), `${w}x${h}`).toBe(false);
  });
  it('only the nine-seat phone ring centres its plates; every other rests them on the station', () => {
    expect(topChairRest('9', 600, 1298)).toBe('centre');
    for (const seats of RINGS.map(String))
      for (const [w, h] of [
        [390, 844],
        [600, 1298],
        [768, 1024],
      ])
        if (!(seats === '9' && phoneReferenceLayout(w, h)))
          expect(topChairRest(seats, w, h), `${seats} seats at ${w}x${h}`).toBe('bottom');
  });
});

describe('the plate rests on its station, by arithmetic', () => {
  it.each(CANVASES)('$name', (canvas) => {
    const felt = canvas.ringTop + (canvas.ringHeight * FELT_WINDOW.top) / 100;
    for (const stationPct of [5, 6])
      for (const plateHeight of PLATES)
        for (const scale of [1, 0.65])
          // Wherever the plate starts: on the felt (the defect), or up at the bar.
          for (const plateTop of [canvas.ringTop + 110, canvas.ringTop - 40, 0]) {
            const station = canvas.ringTop + (canvas.ringHeight * stationPct) / 100;
            const bottom = (rest: 'bottom' | 'centre') =>
              plateTop +
              topChairRailShift({ ...canvas, stationPct, plateTop, plateHeight, scale, rest }) *
                scale +
              plateHeight;
            expect(bottom('bottom')).toBeCloseTo(station, 6);
            expect(bottom('bottom')).toBeLessThan(felt);
            // The nine-seat phone ring: centred on the station, never past the felt.
            expect(bottom('centre')).toBeCloseTo(Math.min(station + plateHeight / 2, felt), 6);
            expect(bottom('centre')).toBeLessThanOrEqual(felt + 1e-9);
          }
  });
  it('nothing above the chair is an input: not the bar, the portrait, a caption or the jackpot', () => {
    const body = sliceMethod(
      read('src/components/table/topChairRail.ts'),
      'export function topChairRailShift'
    );
    const code = body.slice(body.indexOf('}): number {'));
    expect(code).toContain('stationPct');
    expect(code).not.toMatch(/header|bar\b|avatar|portrait|crown|caption|card|chrome|jackpot|bbj/i);
  });
});

/* The real hook, in happy-dom, on a ring laid out like the measured layouts. */
type Pod = { x: number; y: number; art: number };
function Ring({ seats, tournament, pods }: { seats: number; tournament: boolean; pods: Pod[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(ref, 'law');
  const ring = { left: 0, top: 205, width: 600, height: 894.3 };
  return (
    <div className="multi-table-page">
      <div className="multi-table-page__tab-bar-wrapper" data-box="0,0,600,150" />
      <div className="table-page" data-seats={seats} data-box="0,150,600,1148">
        <div className="bbj-widget" data-box="6,150,226,22" />
        <div className="bbj-mini-plate" data-box="6,172,134,19" />
        <div
          className="table-scaler"
          data-box={`${ring.left},${ring.top},${ring.width},${ring.height}`}
          ref={ref}
        >
          <div
            className="table-surface"
            data-box={`80,${ring.top + (ring.height * FELT_WINDOW.top) / 100},440,700`}
          />
          <div className="community-area" data-box={`116,${ring.top + 380},367,101`} />
          {pods.map((p, i) => {
            const cx = ring.left + (ring.width * p.x) / 100;
            const station = ring.top + (ring.height * p.y) / 100;
            // CSS leaves the plate on the felt: the defect the hook must undo.
            const plateTop = station + 70;
            return (
              <div
                key={i}
                data-chair={i}
                className={`seat-wrapper seat-wrapper--cap${tournament ? '' : ' seat-wrapper--top'}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="seat" data-box={`${cx - 48},${plateTop - 80},96,120`}>
                  <img
                    className="seat__avatar-img"
                    src={`/avatars/table/${p.art ? 'free_penguin' : 'vip_wolf'}@2x.webp`}
                    data-box={`${cx - 63},${plateTop + 4 - 126},126,126`}
                    alt=""
                  />
                  <div className="seat__info" data-box={`${cx - 48},${plateTop},96,47`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const VIEWPORTS = [
  { name: 'raw 390x844 phone', width: 390, height: 844 },
  { name: '600x1298 phone reference layout', width: 600, height: 1298 },
  { name: '768x1024 tablet', width: 768, height: 1024 },
] as const;

describe('the real layout hook stands every top chair on the rail', () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = installCssTranslateShim();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? '')
        .split(',')
        .map(Number);
      const pod = this.closest<HTMLElement>('.seat-wrapper--cap');
      const [, py = 0] = (pod?.style.translate || '0px 0px').split(' ').map(parseFloat);
      return {
        left,
        top: top + py,
        width,
        height,
        right: left + width,
        bottom: top + py + height,
        x: left,
        y: top + py,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });
  afterEach(() => {
    restore();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const viewport of VIEWPORTS)
    for (const tournament of [false, true])
      it.each(RINGS)(
        `${viewport.name}, ${tournament ? 'tournament' : 'cash'}: %i seats`,
        (seats) => {
          vi.stubGlobal('innerWidth', viewport.width);
          vi.stubGlobal('innerHeight', viewport.height);
          // A penguin beside a wolf: transparent head-room is not an input.
          const pods = DRAWABLE_SEAT_RINGS[seats]
            .filter((p) => isTopCapSeat(p.y))
            .map((p, i) => ({ ...p, art: i % 2 }));
          const h = render(<Ring seats={seats} tournament={tournament} pods={pods} />);
          const ring = h.container.querySelector('.table-scaler')!.getBoundingClientRect();
          const felt = h.container.querySelector('.table-surface')!.getBoundingClientRect();
          const rest = topChairRest(String(seats), viewport.width, viewport.height);
          const bottoms = new Map<number, number[]>();
          pods.forEach((p, i) => {
            const chair = h.container.querySelector<HTMLElement>(`[data-chair="${i}"]`)!;
            expect(chair.style.translate, 'the hook placed the pod').not.toBe('');
            const plate = chair.querySelector('.seat__info')!.getBoundingClientRect();
            const art = chair.querySelector('.seat__avatar-img')!.getBoundingClientRect();
            const station = ring.top + (ring.height * p.y) / 100;
            const expected =
              rest === 'centre' ? Math.min(station + plate.height / 2, felt.top) : station;
            expect(plate.bottom).toBeCloseTo(expected, 3);
            expect(plate.bottom).toBeLessThanOrEqual(felt.top + 1e-6);
            expect(art.bottom).toBeLessThanOrEqual(felt.top + 1e-6);
            bottoms.set(p.y, [...(bottoms.get(p.y) ?? []), plate.bottom]);
          });
          // Chairs on one top rail line sit level.
          for (const line of bottoms.values())
            expect(Math.max(...line) - Math.min(...line)).toBeLessThanOrEqual(0.01);
        }
      );
});

describe('the mechanisms that put them on the felt stay out', () => {
  const hook = read('src/hooks/useProtectedCardLayout.ts');
  const allocator = read('src/components/table/opponentAvatarLayout.ts');
  const fitter = read('src/components/table/mobileAvatarEnlargement.ts');
  const guard = read('tests/e2e/support/mobileLiveTableLayout.ts');

  it('a tournament top chair is in the lane wherever top chairs stand on the rail', () => {
    const lane = sliceStatement(hook, 'const topPods = () =>');
    expect(lane).toContain('topChairRailViewport(window.innerWidth, window.innerHeight) ||');
    expect(lane).toContain("'.seat-wrapper--cap, .seat-wrapper--top'");
  });
  it('the hook rests every top pod on its station before any other placement', () => {
    const placed = sliceBetween(hook, 'for (const entry of placed) {', 'let level =');
    expect(placed).toContain('railRule && plate && stationIsOnTheTopRail(station)');
    expect(placed).toContain('topChairRailShift(');
    expect(placed).toContain('rest: railRest');
    expect(placed.indexOf('topChairRailShift(')).toBeLessThan(placed.indexOf('if (sixMax)'));
    expect(hook).toContain(
      'const railRule = topChairRailViewport(window.innerWidth, window.innerHeight);'
    );
  });
  it('the chair allocator never nudges a rail-placed chair, on any ring', () => {
    const predicate = sliceStatement(allocator, 'const railCapSeat = (seat: HTMLElement) =>');
    expect(predicate).toContain('topChairRailViewport(window.innerWidth, window.innerHeight)');
    expect(predicate).not.toMatch(/seats|sixSeat/);
  });
  it('the size fitter lets every rail-placed portrait pass behind the tab bar instead of shrinking', () => {
    const seats = sliceMethod(fitter, 'function topRailSeats(');
    expect(seats).toContain('topChairRailViewport(window.innerWidth, window.innerHeight)');
    expect(fitter).toContain('openTop: railTopSeats.has(item.e.seat)');
  });
  it('the browser guard and the live proof check every ring in the rail viewport', () => {
    const block = sliceBetween(guard, 'const railViewport =', 'const footerControls');
    expect(block).toContain('innerWidth <= 768 && innerHeight > innerWidth');
    expect(block).not.toMatch(/dataset\.seats === '6'/);
    for (const check of [
      'Station Is Not On The Rail',
      'Plate Left Its Rail Station',
      'Plate Over The Felt',
      'Plate Covers The Jackpot',
      'Portrait Over The Felt',
      'Portrait Covers The Jackpot',
      'Portrait Is Not Under The Tab Bar',
    ])
      expect(block, check).toContain(check);
    // The retired top-down placement is no longer demanded on a phone.
    const retired = sliceBetween(guard, '  if (railViewport) {\n    // The rail block', 'return {');
    expect(retired).toContain('Six-Max Crown Does Not Meet The Top Bar');
    expect(retired).toContain('Top Player Does Not Sit Immediately Below Mini BBJ');
  });
});
