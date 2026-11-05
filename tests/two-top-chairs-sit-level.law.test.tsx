/**
 * LAW: two chairs on one top rail line sit level, whatever character either
 * player wears (Dan 2026-11-05, live FLH 0.50/1 on a phone: "MAMAPRIYA IS TOO
 * LOW").
 *
 * Library avatar canvases carry transparency above the head (free_penguin
 * 31%, vip_wolf 4%; AVATAR_CROWN_TOP), and the table normalizes the painted
 * figure, so two top chairs have image boxes of different heights. The phone
 * top lane anchored each pod by its image box and parked MamaPriya's penguin
 * 51px below BigJake's wolf. `useProtectedCardLayout` now places each pod as
 * before and then raises a pod whose plate lands below another plate on its
 * rail line, never past the point where its PAINTED crown would break the
 * jackpot clearance. Same-art lanes keep their exact placement.
 */
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AVATAR_CROWN_TOP, paintedAvatarTop } from '../src/components/table/avatarCrownBounds';
import { useProtectedCardLayout } from '../src/hooks/useProtectedCardLayout';
import { installCssTranslateShim } from './unit/support/cssTranslateShim';

// The painted figure is the same height for every character; the box grows by
// the art's transparent head-room (live: penguin box 174, wolf box 123).
const FIGURE = 118;
const boxHeight = (art: string) => FIGURE / (1 - (AVATAR_CROWN_TOP[art] ?? 0));
const MINI_BOTTOM = 34;

function TopLane({ left, right }: { left: string; right: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(ref, 'law');
  const pod = (chair: string, art: string, x: number) => {
    const h = boxHeight(art);
    return (
      <div className="seat-wrapper--top" data-chair={chair}>
        <img
          className="seat__avatar-img"
          src={`/avatars/table/${art}`}
          data-box={`${x},100,${h},${h}`}
          alt=""
        />
        <div className="seat__info" data-box={`${x + 20},${100 + h - 4},96,37`} />
      </div>
    );
  };
  return (
    <div className="table-page" data-seats={9} data-box="0,0,393,852">
      <div className="bbj-mini-plate" data-box="130,20,140,14" />
      <div className="table-scaler" data-box="0,0,393,600" ref={ref}>
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

const measure = (left: string, right: string) => {
  const h = render(<TopLane left={left} right={right} />);
  const read = (chair: string) => ({
    plate: h.container
      .querySelector(`[data-chair="${chair}"] .seat__info`)!
      .getBoundingClientRect().top,
    box: h.container
      .querySelector(`[data-chair="${chair}"] .seat__avatar-img`)!
      .getBoundingClientRect().top,
    crown: paintedAvatarTop(
      h.container.querySelector<HTMLImageElement>(`[data-chair="${chair}"] .seat__avatar-img`)!
    ),
  });
  const result = { left: read('left'), right: read('right') };
  cleanup();
  return result;
};

it("MamaPriya's penguin sits level with BigJake's wolf", () => {
  const { left, right } = measure('free_penguin@2x.webp', 'vip_wolf@2x.webp');
  expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
});

it('a lane where both chairs wear the same art keeps its exact placement', () => {
  const { left, right } = measure('vip_wolf@2x.webp', 'vip_wolf@2x.webp');
  // The legacy lane: each image box keeps 8px of air below the jackpot plate.
  expect(left.box).toBeCloseTo(MINI_BOTTOM + 8);
  expect(right.box).toBeCloseTo(MINI_BOTTOM + 8);
  expect(left.plate).toBeCloseTo(right.plate);
});

const library = Object.keys(AVATAR_CROWN_TOP).filter((art) => art.endsWith('@2x.webp'));

it.each(library)(
  '%s beside a crown-free or a deep-crown neighbour: level, and no painted head breaks the jackpot clearance',
  (art) => {
    for (const neighbour of ['free_business@2x.webp', 'vip_vigilante@2x.webp']) {
      for (const [a, b] of [
        [art, neighbour],
        [neighbour, art],
      ]) {
        const { left, right } = measure(a, b);
        expect(left.crown).toBeGreaterThanOrEqual(MINI_BOTTOM + 8 - 0.01);
        expect(right.crown).toBeGreaterThanOrEqual(MINI_BOTTOM + 8 - 0.01);
        expect(Math.abs(left.plate - right.plate)).toBeLessThanOrEqual(2);
      }
    }
  }
);
