/**
 * LAW: on a phone, the six-max top seat stands on the rail. Never on the felt.
 *
 * Dan 2026-11-22, with a phone screenshot of a watched 6-max PLO5 table: "IN
 * THE 6 MAX GAMES THE TOP VILLAIN IS TO LOW ON THE TABLE! THEY MUST 100% OF
 * THE TIME BE ON THE RAIL AND NEVER ON TOP OF THE TABLE OR OVERLAPPING THE
 * FELT. THE TOP OF THAT VILLAINS HEAD CAN BE 'CUT OFF' AT THE TOP OR 'UNDER
 * THE ACTION BAR' WITH THE ACTION BAR BEING LAYER 1 AND THE AVATAR LAYER 2."
 *
 * How it broke. The chair was placed from the TOP DOWN. useProtectedCardLayout
 * raised the pod until the portrait's crown met the tab bar, and the chair
 * allocator (opponentAvatarLayout `space()`, bound `top` = the bar's bottom
 * edge) then pushed the whole pod back down until the crown AND the action
 * caption lane reserved above it (2026-11-14) were clear of the bar. Whatever
 * did not fit above the rail was paid for by the name plate, on the felt.
 * Measured on the real components at the 600x1298 phone layout: plate bottom
 * 10.5% down the canvas seated (2.1 portrait), 12.7% watched (2.3, raised
 * 2026-11-18), 16.0% watched on a 600x1065 canvas. The felt window starts at
 * 8.9%.
 *
 * The chair is now placed from the RAIL UP (src/components/table/sixSeatTopRail.ts):
 * the plate's bottom edge rests on the chair's own rail station (y 5), nothing
 * above the chair is an input, the allocator never nudges it, and the tab bar
 * paints above the portrait. No portrait changes size (CLAUDE.md 10.7c).
 */
import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sixSeatPhoneRail,
  sixSeatTopCaptionDrop,
  sixSeatTopRailShift,
  stationIsOnTheTopRail,
} from '../src/components/table/sixSeatTopRail';
import { FELT_WINDOW } from '../src/components/table/tableGeometry';
import {
  SIX_SEAT_PHONE_BUST_SCALE,
  SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE,
} from '../src/components/table/mobileAvatarSize';
import { seatLayoutFor, SEAT_POSITIONS_6MAX } from '../src/lib/tableSeatGeometry';
import { useProtectedCardLayout } from '../src/hooks/useProtectedCardLayout';
import { installCssTranslateShim } from './unit/support/cssTranslateShim';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

/** The table canvas (`.table-scaler`) at each phone the layout was measured
 * on, in layout px at the 600px phone layout, with the tab bar's bottom edge.
 * 390x844 and 393x852 share the 600x1298 canvas; 320x568 and 375x667 the
 * 600x1065 one; the last two are Safari with its toolbars showing. */
const CANVASES = [
  { phone: '390x844 notched', ringTop: 295.5, ringHeight: 802.8, bar: 150 },
  { phone: '390x844 with the tournament ticker', ringTop: 347.5, ringHeight: 802.8, bar: 202 },
  { phone: '320x568 / 375x667', ringTop: 211.1, ringHeight: 712.3, bar: 78 },
  { phone: '390x663 toolbars showing', ringTop: 186.9, ringHeight: 667.8, bar: 78 },
  { phone: '390x585 toolbars and keyboard bar', ringTop: 185.6, ringHeight: 624.4, bar: 78 },
] as const;
/** Cash plate 47, tournament plate 53.6 (measured). */
const PLATES = [47, 53.6] as const;

describe('the station is the rail', () => {
  it('a six-seat ring has exactly one top chair, and its station is above the felt', () => {
    const top = seatLayoutFor(6).filter((p) => p.y < 20);
    expect(top).toEqual([{ x: 50, y: 5 }]);
    expect(SEAT_POSITIONS_6MAX[3]).toEqual({ x: 50, y: 5 });
    expect(stationIsOnTheTopRail(top[0].y)).toBe(true);
    expect(top[0].y).toBeLessThan(FELT_WINDOW.top);
  });
  it('a station on the felt is refused rather than obeyed', () => {
    expect(stationIsOnTheTopRail(FELT_WINDOW.top)).toBe(false);
    expect(stationIsOnTheTopRail(25)).toBe(false);
    expect(stationIsOnTheTopRail(Number.NaN)).toBe(false);
  });
  it('applies to the phone reference layout only', () => {
    expect(sixSeatPhoneRail('6', 600, 1298)).toBe(true);
    expect(sixSeatPhoneRail('6', 600, 1065)).toBe(true);
    expect(sixSeatPhoneRail('9', 600, 1298)).toBe(false);
    expect(sixSeatPhoneRail('6', 390, 844)).toBe(false);
    expect(sixSeatPhoneRail('6', 768, 1024)).toBe(false);
    expect(sixSeatPhoneRail('6', 1280, 800)).toBe(false);
  });
});

describe('the plate rests on the station, by arithmetic', () => {
  it.each(CANVASES)('$phone: the plate is on the rail and clear of the felt', (canvas) => {
    for (const plateHeight of PLATES)
      for (const scale of [1, 0.65])
        // Wherever the plate starts: on the felt (the defect), or up at the bar.
        for (const plateTop of [canvas.ringTop + 110, canvas.ringTop - 40, canvas.bar]) {
          const shift = sixSeatTopRailShift({
            ringTop: canvas.ringTop,
            ringHeight: canvas.ringHeight,
            stationPct: 5,
            plateTop,
            plateHeight,
            scale,
          });
          const bottom = plateTop + shift * scale + plateHeight;
          const felt = canvas.ringTop + (canvas.ringHeight * FELT_WINDOW.top) / 100;
          expect(bottom).toBeCloseTo(canvas.ringTop + canvas.ringHeight * 0.05, 6);
          expect(bottom).toBeLessThan(felt);
          // The whole plate is on the top 5% of the canvas: none of it is felt.
          expect(felt - bottom).toBeGreaterThan(canvas.ringHeight * 0.03);
        }
  });
  it('nothing above the chair is an input: not the bar, the portrait or a caption', () => {
    // The old placement took the tab bar, the crown and the caption lane and
    // paid for them with the plate. The new one cannot: it is not told them.
    const base = { ringTop: 295.5, ringHeight: 802.8, stationPct: 5, plateHeight: 47, scale: 1 };
    const seated = sixSeatTopRailShift({ ...base, plateTop: 333.1 });
    const watched = sixSeatTopRailShift({ ...base, plateTop: 350.1 });
    // Different starting points (2.1 and 2.3 portraits), one resting place.
    expect(333.1 + seated).toBeCloseTo(350.1 + watched, 6);
    expect(Object.keys({ ...base, plateTop: 0 }).sort()).toEqual(
      ['plateHeight', 'plateTop', 'ringHeight', 'ringTop', 'scale', 'stationPct'].sort()
    );
    const source = read('src/components/table/sixSeatTopRail.ts');
    const from = source.indexOf(
      '}): number {',
      source.indexOf('export function sixSeatTopRailShift')
    );
    const shiftBody = source.slice(from, source.indexOf('\n}\n', from));
    expect(shiftBody).toContain('stationPct');
    expect(shiftBody).not.toMatch(/header|bar|avatar|portrait|crown|caption|card|chrome/i);
  });
  it('the approved portrait sizes are what they were (10.7c): room is made, nothing shrinks', () => {
    expect(SIX_SEAT_PHONE_BUST_SCALE).toBe(2.1);
    expect(SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE).toBe(2.3);
    expect(read('src/components/table/sixSeatTopRail.ts')).not.toMatch(
      /localStorage|sessionStorage|bust-scale|--sp-mobile-art-scale/
    );
  });
});

describe('the caption stays in front of the tab bar without moving the chair', () => {
  it.each(CANVASES)('$phone', (canvas) => {
    for (const portrait of [175.2, 191.9]) {
      // Plate bottom on the station; the seat box is the pod above it and the
      // crown rises above the seat box by what is left of the portrait.
      const seatTop = canvas.ringTop + canvas.ringHeight * 0.05 - 109.6;
      const rise = portrait - 82;
      const drop = sixSeatTopCaptionDrop({
        seatTop,
        rise,
        tagHeight: 20,
        headerBottom: canvas.bar,
        scale: 1,
      });
      const captionTop = seatTop - (rise + 20 + 6) + drop;
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(captionTop).toBeGreaterThanOrEqual(canvas.bar + 3);
    }
  });
  it('a lane that is already on screen is left exactly where it is', () => {
    expect(
      sixSeatTopCaptionDrop({ seatTop: 600, rise: 90, tagHeight: 20, headerBottom: 150, scale: 1 })
    ).toBe(0);
  });
});

/* The real hook, in jsdom, on boxes shaped like the measured phone layout. */
function SixMaxTop({ barBottom, portrait }: { barBottom: number; portrait: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(ref, 'law');
  // The pod as CSS lays it out before any shift: centred on its station.
  const ring = { top: barBottom + 145.5, height: 802.8 };
  const station = ring.top + ring.height * 0.05;
  const plateTop = station + 54.8 - 47;
  return (
    <div className="multi-table-page">
      <div className="multi-table-page__tab-bar-wrapper" data-box={`0,0,600,${barBottom}`} />
      <div
        className="table-page"
        data-seats={6}
        data-box={`0,${barBottom},600,${1298 - barBottom}`}
      >
        <div className="table-scaler" data-box={`36,${ring.top},528,${ring.height}`} ref={ref}>
          <div className="table-surface" data-box={`106.2,${ring.top + 71.4},386.5,644.6`} />
          <div className="community-area" data-box={`116,${ring.top + 295},367,101`} />
          <div className="seat-wrapper seat-wrapper--top seat-wrapper--cap" style={{ top: '5%' }}>
            <div className="seat" data-box={`252,${station - 54.8},96,109.6`}>
              <img
                className="seat__avatar-img"
                src="/avatars/table/vip_wolf@2x.webp"
                data-box={`${300 - portrait / 2},${plateTop + 20.8 - portrait},${portrait},${portrait}`}
                alt=""
              />
              <div className="seat__info" data-box={`252,${plateTop},96,47`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

describe('the real layout hook puts the plate on the station', () => {
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
    vi.stubGlobal('innerWidth', 600);
    vi.stubGlobal('innerHeight', 1298);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(528);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? '')
        .split(',')
        .map(Number);
      const pod = this.closest<HTMLElement>('.seat-wrapper--top');
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

  it.each([
    { name: 'seated, 2.1 portrait', barBottom: 150, portrait: 175.2 },
    { name: 'watched, 2.3 portrait', barBottom: 150, portrait: 191.9 },
    { name: 'watched under the tournament ticker', barBottom: 202, portrait: 191.9 },
    { name: 'a portrait far taller than the room above the rail', barBottom: 150, portrait: 320 },
  ])('$name', ({ barBottom, portrait }) => {
    const h = render(<SixMaxTop barBottom={barBottom} portrait={portrait} />);
    const ring = h.container.querySelector('.table-scaler')!.getBoundingClientRect();
    const felt = h.container.querySelector('.table-surface')!.getBoundingClientRect();
    const plate = h.container.querySelector('.seat__info')!.getBoundingClientRect();
    const art = h.container.querySelector('.seat__avatar-img')!.getBoundingClientRect();
    const pod = h.container.querySelector<HTMLElement>('.seat-wrapper--top')!;
    expect(pod.style.translate, 'the hook placed the pod').not.toBe('');
    expect(plate.bottom).toBeCloseTo(ring.top + ring.height * 0.05, 3);
    expect(plate.bottom).toBeLessThan(felt.top);
    expect(art.bottom).toBeLessThan(felt.top);
    // The crown goes wherever the rail leaves it, under the bar if need be.
    if (portrait > 200) expect(art.top).toBeLessThan(barBottom);
  });
});

describe('the mechanisms that put it on the felt stay out', () => {
  const hook = read('src/hooks/useProtectedCardLayout.ts');
  const allocator = read('src/components/table/opponentAvatarLayout.ts');
  const fitter = read('src/components/table/mobileAvatarEnlargement.ts');

  it('the hook places the phone six-max top pod with sixSeatTopRailShift', () => {
    const branch = hook.slice(hook.indexOf('for (const entry of placed) {'));
    const sixMax = branch.slice(branch.indexOf('if (sixMax) {'), branch.indexOf('let level ='));
    expect(sixMax).toContain('sixSeatTopRailShift(');
    expect(sixMax).toContain('stationIsOnTheTopRail(station)');
  });
  it('the chair allocator never nudges the rail-placed chair', () => {
    // It is a fixed fact for the other chairs, not an item to be solved.
    expect(allocator).toMatch(
      /const spacedSeats = \(\) => movableSeats\(\)\.filter\(\(seat\) => !railCapSeat\(seat\)\)/
    );
    const space = allocator.slice(allocator.indexOf('const space = () => {'));
    expect(space).toContain('holdRailCapSeats();');
    expect(space).toMatch(/const seats = spacedSeats\(\);/);
    expect(space).toContain('...railCapFacts()');
    const wager = allocator.slice(
      allocator.indexOf('const tryShiftOwnerForWager'),
      allocator.indexOf('const captionRaiseBounds')
    );
    expect(wager).toMatch(/railCapSeat\(seat\) \|\|/);
    expect(wager).toMatch(/const seats = spacedSeats\(\);/);
    // And holding it is a write of zero, never a read of its own last nudge.
    const hold = allocator.slice(
      allocator.indexOf('const holdRailCapSeats'),
      allocator.indexOf('const tryShiftOwnerForWager')
    );
    expect(hold).toContain("setProperty('--sp-opponent-y', '0px')");
    expect(hold).toContain('state.shifts.set(seat, [0, 0])');
  });
  it('the size fitter lets that one portrait pass behind the tab bar instead of shrinking', () => {
    expect(fitter).toMatch(
      /element\.matches\('\.table-tab-bar'\)\)\s*boxes\.push\(\{ box, owner: railTop, layer: false, overlay: true \}\)/
    );
    expect(fitter).toContain('item.openTop ? openTopViewport : viewport');
  });
  it('the tab bar paints above the table, opaque, so a crown behind it is hidden', () => {
    const css = read('src/pages/MultiTablePage.css');
    const rule = css.slice(css.indexOf('\n.multi-table-page__tab-bar-wrapper {'));
    const body = rule.slice(0, rule.indexOf('\n}\n'));
    expect(body).toMatch(/\n\s*background: #000;/);
    const z = Number(/\n\s*z-index: (\d+);/.exec(body)?.[1]);
    expect(z).toBeGreaterThanOrEqual(350);
    // Nothing between the bar's parent and the table claims a higher layer.
    for (const selector of ['.multi-table-page__container', '.multi-table-page__table-slot']) {
      const at = css.indexOf(`\n${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      const block = css.slice(at, css.indexOf('\n}\n', at));
      const own = /\n\s*z-index: (\d+);/.exec(block);
      if (own) expect(Number(own[1])).toBeLessThan(z);
    }
    const seat = read('src/components/table/SeatSlot.css');
    expect(seat).toContain('var(--sp-rail-caption-drop, 0px)');
  });
});
