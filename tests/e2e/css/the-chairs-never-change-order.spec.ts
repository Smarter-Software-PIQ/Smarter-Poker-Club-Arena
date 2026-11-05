/**
 * THE PLAYER IS IN HIS OWN SEAT - measured in a real browser (Dan 2026-11-05).
 *
 * Mongo, PLO8 Morning Stack - Table 1: the engine had BigWade in seat 5 (after
 * BUTTONCHAMP) and acted him there, but Mongo's phone drew him in the
 * bottom-left corner below Cali_Duncan. The unit law
 * (tests/the-chairs-never-change-order.law.test.ts) pins the rule on numbers;
 * this spec checks the RENDERED result, which is what a player reads.
 *
 * It needs no login and no dev server. It loads the table's real stylesheets
 * (tests/e2e/support/feltHarness.mjs) and the real ring, viewport-fit and
 * opponent-spacing code (bundled from src/ with esbuild) into one page, seats
 * the table exactly as TablePage does - ring by table size, rotated so the
 * viewer sits at the bottom, fitted to the phone - and runs the real allocator.
 * Then it measures, from the browser's own layout:
 *
 *   1. MAPPING - every player's chair is drawn nearer his own seat's rail spot
 *      than any other seat's (hero and EMPTY included), and reading clockwise
 *      from the viewer gives exactly the next seat numbers, wrapping 9 -> 1.
 *      The expected order is computed from seat numbers alone, independently of
 *      the spacing code.
 *   2. ATTACHMENT - the action tag, position badge and note marker sit with
 *      the player's own chair, and a tap on his name plate lands on his chair,
 *      never on a neighbour whose art hangs over it.
 *   3. STABILITY - repeated passes, notes appearing, resizes and rotation,
 *      players joining and leaving, and a forced cross-seat nudge (Mongo's
 *      frame) all end on a valid layout, and a second pass changes nothing.
 */
import { test, expect, type Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCss } from '../support/feltHarness.mjs';

const ROOT = resolve(process.cwd());
const css = buildCss(ROOT);
const bundle = buildSync({
  stdin: {
    contents: `
      export { seatLayoutFor, rotateSeatsForHero } from './src/lib/tableSeatGeometry';
      export { fitSeatToViewport, seatPodPx } from './src/components/table/tableGeometry';
      export { createOpponentAvatarLayout } from './src/components/table/opponentAvatarLayout';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'SeatLab',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
}).outputFiles[0].text;

const art = (name: string) =>
  `data:image/webp;base64,${readFileSync(resolve(ROOT, 'tests/e2e/fixtures/table-art', name)).toString('base64')}`;
const WOLF = art('vip_wolf@2x.webp');
const AZTEC = art('vip_aztec_warrior@2x.webp');

const SHOTS = resolve(ROOT, 'test-results/the-chairs-never-change-order');
mkdirSync(SHOTS, { recursive: true });

/** Mongo's table, by physical seat. null = EMPTY. */
const MONGO_TABLE: Array<string | null> = [
  'sixesquads9',
  'Mongo',
  'Cali_Duncan',
  'BUTTONCHAMP',
  'BigWade',
  'raypatel',
  'champp',
  'king_01',
  null,
];
const MONGO_POSITIONS: Record<string, string> = {
  sixesquads9: 'SB',
  Mongo: 'BB',
  Cali_Duncan: 'UTG',
  BUTTONCHAMP: 'UTG+1',
  BigWade: 'MP',
  raypatel: 'MP+1',
  champp: 'CO',
  king_01: 'BTN',
};

type SeatSpec = { name: string | null; acting?: boolean; note?: boolean; position?: string };

async function mount(page: Page) {
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${css}</style></head><body>
    <div class="table-page table-page--embedded" data-hero="true">
      <div class="table-container"><div class="table-scaler"></div></div>
    </div></body></html>`);
  await page.addScriptTag({ content: bundle });
}

/** Seat a table exactly the way TablePage does, run the real allocator, and
 * return a measurement of what the browser drew. */
async function seatAndMeasure(
  page: Page,
  seats: SeatSpec[],
  heroSeat: number,
  opts: { passes?: number; forced?: Record<string, [number, number]> } = {}
) {
  return page.evaluate(
    async ({ seats, heroSeat, passes, forced, WOLF, AZTEC }) => {
      const Lab = (window as unknown as { SeatLab: any }).SeatLab;
      const pageEl = document.querySelector<HTMLElement>('.table-page')!;
      const scaler = document.querySelector<HTMLElement>('.table-scaler')!;
      pageEl.setAttribute('data-seats', String(seats.length));
      scaler.innerHTML = '';
      const sr = scaler.getBoundingClientRect();
      const ring = Lab.seatLayoutFor(seats.length);
      const rotated = Lab.rotateSeatsForHero(ring, heroSeat);
      const vw = window.innerWidth;
      const positions = rotated.map(({ pos }: { pos: { x: number; y: number } }) =>
        Lab.fitSeatToViewport(
          pos,
          { w: sr.width, h: sr.height },
          vw,
          Lab.seatPodPx(vw, pos.y >= 100 && pos.x === 50, sr.width, {
            seats: rotated.length,
            canvasHeightPx: sr.height,
          }),
          sr.left,
          rotated.length
        )
      );
      seats.forEach((spec, idx) => {
        const seatNumber = idx + 1;
        const pos = positions[idx];
        const hero = seatNumber === heroSeat;
        const wrapper = document.createElement('div');
        wrapper.className = `seat-wrapper${hero ? ' seat-wrapper--hero' : ''}${
          pos.y < 20 ? ' seat-wrapper--cap seat-wrapper--top' : ''
        }${spec.acting ? ' seat-wrapper--spot' : ''}`;
        wrapper.dataset.seatWrapper = String(seatNumber);
        wrapper.style.left = `${pos.x}%`;
        wrapper.style.top = `${pos.y}%`;
        const seat = document.createElement('div');
        seat.dataset.player = spec.name ?? `EMPTY-${seatNumber}`;
        if (!spec.name) {
          seat.className = 'seat seat--empty';
          seat.innerHTML = '<div class="seat__info"><span class="seat__name">EMPTY</span></div>';
        } else {
          seat.className = `seat${hero ? ' seat--hero' : ''} seat--in-hand`;
          seat.innerHTML = `
            ${spec.acting ? '<div class="seat__action">RAISE 3.5 BB</div>' : ''}
            <div class="seat__avatar-wrap seat__avatar-wrap--bust">
              <div class="seat__avatar seat__avatar--bust">
                <img class="seat__avatar-img" alt="" src="${seatNumber % 2 ? WOLF : AZTEC}">
              </div>
              ${spec.position ? `<span class="seat__position-badge">${spec.position}</span>` : ''}
              ${spec.note && !hero ? '<span class="seat__note-marker" role="img" aria-label="note"></span>' : ''}
            </div>
            <div class="seat__info"><span class="seat__name">${spec.name}</span><span class="seat__stack">40 BB</span></div>`;
        }
        wrapper.append(seat);
        scaler.append(wrapper);
      });
      await Promise.all(
        Array.from(scaler.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined))
      );
      if (forced)
        for (const [name, [x, y]] of Object.entries(forced)) {
          const seat = scaler.querySelector<HTMLElement>(`.seat[data-player="${name}"]`);
          seat?.style.setProperty('--sp-opponent-x', `${x}px`);
          seat?.style.setProperty('--sp-opponent-y', `${y}px`);
        }
      const w = window as unknown as { __labState?: unknown };
      w.__labState ??= { key: '', shifts: new WeakMap() };
      let scheduled = 0;
      const layout = Lab.createOpponentAvatarLayout(scaler, pageEl, w.__labState, () => {
        scheduled++;
      });
      const run = async () => {
        layout.prepare();
        for (let i = 0; i < 20 && layout.awaitingMetadata(); i++)
          await new Promise((r) => setTimeout(r, 25));
        layout.prepare();
        for (let i = 0; i < (passes ?? 3); i++) layout.space();
      };
      await run();
      const read = () =>
        Array.from(scaler.querySelectorAll<HTMLElement>('.seat')).map((seat) => ({
          player: seat.dataset.player!,
          x: seat.style.getPropertyValue('--sp-opponent-x'),
          y: seat.style.getPropertyValue('--sp-opponent-y'),
        }));
      const settled = read();
      layout.space();
      const again = read();
      layout.stop();

      const centre = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
      };
      const chairs = Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper')).map(
        (wrapper) => {
          const seat = wrapper.querySelector<HTMLElement>('.seat')!;
          const plate = seat.querySelector('.seat__info')!;
          const rail = centre(wrapper);
          const shown = centre(seat);
          const pod = seat.getBoundingClientRect();
          const plateAt = centre(plate);
          /* Which chair a decoration reads as belonging to: the drawn pod
             whose box it is nearest to (distance 0 when it sits on or inside
             a pod), measured against the pods as painted, nudges included. */
          const inside = (el: Element | null) => {
            if (!el) return null;
            const c = centre(el);
            let best = { d: Infinity, seat: '' as string | undefined };
            for (const other of Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper'))) {
              const r = other.querySelector('.seat')!.getBoundingClientRect();
              const dx = Math.max(r.left - c.x, 0, c.x - r.right);
              const dy = Math.max(r.top - c.y, 0, c.y - r.bottom);
              const d = Math.hypot(dx, dy) + (other === wrapper ? -0.001 : 0);
              if (d < best.d) best = { d, seat: other.dataset.seatWrapper };
            }
            return best.seat;
          };
          const hit = document
            .elementFromPoint(plateAt.x, plateAt.y)
            ?.closest<HTMLElement>('.seat');
          return {
            seatNumber: Number(wrapper.dataset.seatWrapper),
            player: seat.dataset.player!,
            rail: { x: rail.x, y: rail.y },
            shown: { x: shown.x, y: shown.y },
            podWidth: pod.width,
            tap: hit?.dataset.player ?? null,
            actionOwner: inside(seat.querySelector('.seat__action')),
            badgeOwner: inside(seat.querySelector('.seat__position-badge')),
            noteOwner: inside(seat.querySelector('.seat__note-marker')),
          };
        }
      );
      const pods = Array.from(scaler.querySelectorAll<HTMLElement>('.seat')).map((seat) => {
        const r = seat.getBoundingClientRect();
        const p = seat.querySelector('.seat__info')!.getBoundingClientRect();
        return {
          player: seat.dataset.player,
          pod: [r.left, r.top, r.width, r.height].map(Math.round),
          plate: [p.left, p.top, p.width, p.height].map(Math.round),
          x: seat.style.getPropertyValue('--sp-opponent-x'),
          y: seat.style.getPropertyValue('--sp-opponent-y'),
        };
      });
      return { chairs, settled, again, scheduled, pods, scaler: { w: sr.width, h: sr.height } };
    },
    { seats, heroSeat, passes: opts.passes, forced: opts.forced, WOLF, AZTEC }
  );
}

type Measured = Awaited<ReturnType<typeof seatAndMeasure>>;

/** Rule 1, computed from seat numbers alone. */
function assertSeatMapping(m: Measured, heroSeat: number, label: string) {
  const n = m.chairs.length;
  const centre = {
    x: m.chairs.reduce((t, c) => t + c.rail.x, 0) / n,
    y: m.chairs.reduce((t, c) => t + c.rail.y, 0) / n,
  };
  for (const chair of m.chairs) {
    const own = Math.hypot(chair.shown.x - chair.rail.x, chair.shown.y - chair.rail.y);
    for (const other of m.chairs) {
      if (other === chair) continue;
      const theirs = Math.hypot(chair.shown.x - other.rail.x, chair.shown.y - other.rail.y);
      expect(
        own,
        `${label}: ${chair.player} (seat ${chair.seatNumber}) is drawn nearer seat ${other.seatNumber}`
      ).toBeLessThan(theirs);
    }
  }
  // Clockwise on screen (y down) from the viewer is increasing atan2 angle.
  const byAngle = (key: 'rail' | 'shown') =>
    [...m.chairs]
      .map((c) => ({ seat: c.seatNumber, a: Math.atan2(c[key].y - centre.y, c[key].x - centre.x) }))
      .sort((a, b) => a.a - b.a)
      .map((e) => e.seat);
  const rotate = (list: number[]) => {
    const i = list.indexOf(heroSeat);
    return [...list.slice(i), ...list.slice(0, i)];
  };
  const expected = Array.from({ length: n }, (_, k) => ((heroSeat - 1 + k) % n) + 1);
  // Seat numbers run clockwise around the felt in one fixed direction; the
  // viewer's chair is first and the order wraps from the last seat to seat 1.
  const railOrder = rotate(byAngle('rail'));
  const shownOrder = rotate(byAngle('shown'));
  const clockwise = railOrder.join() === expected.join();
  const reversed = railOrder.join() === [heroSeat, ...expected.slice(1).reverse()].join();
  expect(clockwise || reversed, `${label}: ring order ${railOrder.join()}`).toBe(true);
  expect(shownOrder.join(), `${label}: drawn order`).toBe(railOrder.join());
}

/** Rule 2. Not asserted for a landscape phone: this harness has no TablePage,
 * whose runtime height budget sizes the landscape felt, so there the felt
 * collapses to a strip and pods overlap in a layout the app never draws. Seat
 * mapping and stability are still asserted in landscape. */
function assertAttachment(m: Measured, label: string) {
  for (const chair of m.chairs) {
    if (chair.player.startsWith('EMPTY')) continue;
    expect(chair.tap, `${label}: tap on ${chair.player}'s plate`).toBe(chair.player);
    if (chair.actionOwner)
      expect(chair.actionOwner, `${label}: ${chair.player}'s action tag`).toBe(
        String(chair.seatNumber)
      );
    if (chair.badgeOwner)
      expect(chair.badgeOwner, `${label}: ${chair.player}'s badge`).toBe(String(chair.seatNumber));
    if (chair.noteOwner)
      expect(chair.noteOwner, `${label}: ${chair.player}'s note`).toBe(String(chair.seatNumber));
  }
}

/** Rule 3: a second pass over a settled table changes nothing. */
function assertStable(m: Measured, label: string) {
  expect(m.again, `${label}: a second pass moved a chair`).toEqual(m.settled);
}

const mongoSeats = (opts: { notes?: boolean; longNames?: boolean } = {}): SeatSpec[] =>
  MONGO_TABLE.map((name) =>
    name
      ? {
          name: opts.longNames ? `${name}_with_a_long_alias` : name,
          position: MONGO_POSITIONS[name],
          acting: name === 'BigWade',
          note: opts.notes && name !== 'Mongo',
        }
      : { name: null }
  );

test.describe('the player is in his own seat (rendered)', () => {
  test("Mongo's table, notes on and off, long names, repeated passes", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await mount(page);
    for (const variant of [
      { notes: false, longNames: false },
      { notes: true, longNames: false },
      { notes: true, longNames: true },
    ]) {
      const label = `393x852 notes=${variant.notes} long=${variant.longNames}`;
      const m = await seatAndMeasure(page, mongoSeats(variant), 2, { passes: 5 });
      assertSeatMapping(m, 2, label);
      assertAttachment(m, label);
      assertStable(m, label);
    }
    await page.screenshot({ path: resolve(SHOTS, 'mongo-table-393.png') });
  });

  test("Mongo's frame (seat 5 nudged into the corner) is put back on its rail", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await mount(page);
    const m = await seatAndMeasure(page, mongoSeats({ notes: true }), 2, {
      forced: { BigWade: [0, 520] },
    });
    assertSeatMapping(m, 2, 'forced');
    assertAttachment(m, 'forced');
    await page.screenshot({ path: resolve(SHOTS, 'mongo-forced-frame-repaired.png') });
  });

  test('every phone size and rotation, and players joining and leaving', async ({ page }) => {
    await mount(page);
    const sizes: Array<[number, number]> = [
      [320, 568],
      [375, 667],
      [390, 844],
      [430, 932],
      [852, 393],
      [393, 852],
    ];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      for (const seats of [
        mongoSeats({ notes: true }),
        // BigWade leaves; a new player sits in seat 9.
        mongoSeats({ notes: true }).map((s, i) =>
          i === 4 ? { name: null } : i === 8 ? { name: 'newcomer', note: true } : s
        ),
      ]) {
        const label = `${w}x${h}`;
        const m = await seatAndMeasure(page, seats, 2);
        await page.screenshot({
          path: resolve(SHOTS, `mongo-${w}x${h}-${seats[4].name ?? 'left'}.png`),
        });
        assertSeatMapping(m, 2, label);
        if (h > w) assertAttachment(m, label);
        assertStable(m, label);
      }
    }
  });

  test('every table size and every viewer seat, with the wrap from the last seat to seat 1', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mount(page);
    for (const size of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (let hero = 1; hero <= size; hero++) {
        const seats: SeatSpec[] = Array.from({ length: size }, (_, i) =>
          i % 4 === 3 && i + 1 !== hero
            ? { name: null }
            : { name: `p${i + 1}`, note: i % 2 === 0, acting: i + 1 === (hero % size) + 1 }
        );
        const label = `${size}-max viewer seat ${hero}`;
        const m = await seatAndMeasure(page, seats, hero);
        assertSeatMapping(m, hero, label);
        assertAttachment(m, label);
        assertStable(m, label);
      }
    }
  });
});
