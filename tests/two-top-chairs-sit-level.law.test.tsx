/**
 * LAW: two chairs on one top rail line sit level, whatever character either
 * player wears (Dan 2026-11-05, live FLH 0.50/1 on a phone: "MAMAPRIYA IS TOO
 * LOW"), AND, on a portrait phone or tablet, both stand on the rail (Dan
 * 2026-11-22: "THEY MUST 100% OF THE TIME BE ON THE RAIL AND NEVER ON TOP OF
 * THE TABLE OR OVERLAPPING THE FELT").
 *
 * Library avatar canvases carry transparency above the head (free_penguin
 * 31%, vip_wolf 4%; AVATAR_CROWN_TOP), and the table normalizes the painted
 * figure, so two top chairs have image boxes of different heights. The phone
 * top lane anchored each pod by its image box and parked MamaPriya's penguin
 * 51px below BigJake's wolf. The 2026-11-05 fix levelled each line against the
 * jackpot clearance, and that clearance is what then held every top chair on
 * the felt: a crown kept 8px under the jackpot plate leaves the plate 11-22%
 * down the canvas, against a felt window that starts at 8.9%.
 *
 * On a portrait phone or tablet (topChairRailViewport) each plate now rests on
 * its own rail station (topChairRail.ts), so two chairs on one line share one
 * resting place and are level by construction, whatever art either wears; the
 * jackpot plaque and the tab bar paint above any crown that reaches them. A
 * wider or landscape layout whose table page is 768px or narrower (a tiled
 * desktop table) keeps the 2026-11-05 levelling under the jackpot clearance,
 * and that is still pinned here: neither half of the law is dropped.
 */
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_CROWN_TOP, paintedAvatarTop } from '../src/components/table/avatarCrownBounds';
import { FELT_WINDOW } from '../src/components/table/tableGeometry';
import { useProtectedCardLayout } from '../src/hooks/useProtectedCardLayout';
import { installCssTranslateShim } from './unit/support/cssTranslateShim';

// The painted figure is the same height for every character; the box grows by
// the art's transparent head-room (live: penguin box 174, wolf box 123).
const FIGURE = 118;
const boxHeight = (art: string) => FIGURE / (1 - (AVATAR_CROWN_TOP[art] ?? 0));
const MINI_BOTTOM = 34;
/** The canvas (`.table-scaler`) in the fixture: 0,0 to 393x600. */
const RING = { top: 0, height: 600 };
/** The two top diagonals' station on every ring that has them (y 6). */
const STATION = 6;
const PLATE_H = 37;

function TopLane({ left, right, station }: { left: string; right: string; station?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(ref, 'law');
  const pod = (chair: string, art: string, x: number) => {
    const h = boxHeight(art);
    return (
      <div
        className="seat-wrapper--top"
        data-chair={chair}
        style={station === undefined ? undefined : { top: `${station}%` }}
      >
        <img
          className="seat__avatar-img"
          src={`/avatars/table/${art}`}
          data-box={`${x},100,${h},${h}`}
          alt=""
        />
        <div className="seat__info" data-box={`${x + 20},${100 + h - 4},96,${PLATE_H}`} />
      </div>
    );
  };
  return (
    <div className="table-page" data-seats={9} data-box="0,0,393,852">
      <div className="bbj-mini-plate" data-box="130,20,140,14" />
      <div className="table-scaler" data-box={`0,${RING.top},393,${RING.height}`} ref={ref}>
        <div className="community-area" data-box="60,420,280,90" />
        {pod('left', left, 0)}
        {pod('right', right, 200)}
      </div>
    </div>
  );
}

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
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(393);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? '')
      .split(',')
      .map(Number);
    const pod = this.closest<HTMLElement>('.seat-wrapper--top');
    const [px = 0, py = 0] = (pod?.style.translate || '0px 0px').split(' ').map(parseFloat);
    return {
      left: left + px,
      top: top + py,
      width,
      height,
      right: left + px + width,
      bottom: top + py + height,
      x: left + px,
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

const measure = (left: string, right: string, station?: number) => {
  const h = render(<TopLane left={left} right={right} station={station} />);
  const read = (chair: string) => {
    const plate = h.container
      .querySelector(`[data-chair="${chair}"] .seat__info`)!
      .getBoundingClientRect();
    return {
      plate: plate.top,
      plateBottom: plate.bottom,
      box: h.container
        .querySelector(`[data-chair="${chair}"] .seat__avatar-img`)!
        .getBoundingClientRect().top,
      crown: paintedAvatarTop(
        h.container.querySelector<HTMLImageElement>(`[data-chair="${chair}"] .seat__avatar-img`)!
      ),
    };
  };
  const result = { left: read('left'), right: read('right') };
  cleanup();
  return result;
};

const library = Object.keys(AVATAR_CROWN_TOP).filter((art) => art.endsWith('@2x.webp'));
const pairs = (art: string) =>
  ['free_business@2x.webp', 'vip_vigilante@2x.webp'].flatMap((neighbour) => [
    [art, neighbour],
    [neighbour, art],
  ]);
const stationLine = RING.top + (RING.height * STATION) / 100;
const feltTop = RING.top + (RING.height * FELT_WINDOW.top) / 100;

describe('on a portrait phone or tablet both chairs stand on the rail, level', () => {
  // The 600px phone reference layout and a portrait tablet.
  // The fixture is a nine-seat ring: at 600px its plates keep their approved
  // centred placement (never past the felt); elsewhere the bottom edge rests
  // on the station.
  const VIEWPORTS = [
    {
      name: '600x1298 phone reference layout',
      width: 600,
      height: 1298,
      rest: Math.min(stationLine + PLATE_H / 2, feltTop),
    },
    { name: '768x1024 tablet', width: 768, height: 1024, rest: stationLine },
  ] as const;
  for (const viewport of VIEWPORTS)
    describe(viewport.name, () => {
      beforeEach(() => {
        vi.stubGlobal('innerWidth', viewport.width);
        vi.stubGlobal('innerHeight', viewport.height);
      });
      it("MamaPriya's penguin and BigJake's wolf: level, both on the rail", () => {
        const { left, right } = measure('free_penguin@2x.webp', 'vip_wolf@2x.webp', STATION);
        expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
        for (const chair of [left, right]) {
          expect(chair.plateBottom).toBeCloseTo(viewport.rest, 3);
          expect(chair.plateBottom).toBeLessThanOrEqual(feltTop + 0.01);
        }
      });
      it.each(library)(
        '%s beside a crown-free or a deep-crown neighbour: level, and both plates on the rail',
        (art) => {
          for (const [a, b] of pairs(art)) {
            const { left, right } = measure(a, b, STATION);
            expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
            for (const chair of [left, right]) {
              expect(chair.plateBottom).toBeCloseTo(viewport.rest, 3);
              expect(chair.plateBottom).toBeLessThanOrEqual(feltTop + 0.01);
            }
          }
        }
      );
    });
});

describe('a wide or landscape layout keeps its levelling under the jackpot clearance', () => {
  // happy-dom's default window (1024x768) is landscape: off the rail rule.
  it("MamaPriya's penguin sits level with BigJake's wolf", () => {
    const { left, right } = measure('free_penguin@2x.webp', 'vip_wolf@2x.webp', STATION);
    expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
  });

  it('a same-art lane keeps exactly eight pixels below the visible crowns', () => {
    const { left, right } = measure('vip_wolf@2x.webp', 'vip_wolf@2x.webp', STATION);
    // Transparent canvas is not the head. Keep the exact visible clearance.
    expect(left.crown).toBeCloseTo(MINI_BOTTOM + 8);
    expect(right.crown).toBeCloseTo(MINI_BOTTOM + 8);
    expect(left.box).toBeLessThan(left.crown);
    expect(right.box).toBeLessThan(right.crown);
    expect(left.plate).toBeCloseTo(right.plate);
  });

  it.each(library)(
    '%s beside a crown-free or a deep-crown neighbour: level, and no painted head breaks the jackpot clearance',
    (art) => {
      for (const [a, b] of pairs(art)) {
        const { left, right } = measure(a, b, STATION);
        expect(left.crown).toBeGreaterThanOrEqual(MINI_BOTTOM + 8 - 0.01);
        expect(right.crown).toBeGreaterThanOrEqual(MINI_BOTTOM + 8 - 0.01);
        expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
      }
    }
  );
});
