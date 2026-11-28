import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseMobileAvatarPaint,
  enlargeMobileFrames,
  mobileAvatarCardReservation,
  createMobilePaintState,
  mobilePaintKey,
  resetMobileAvatarPaint,
} from '../../src/components/table/mobileAvatarEnlargement';

const art = [{ left: 50, top: 40, width: 20, height: 40 }];
const viewport = { left: 0, top: 0, width: 300, height: 400 };
const awayFelt = { left: 200, top: 100, width: 80, height: 200 };
const choose = (
  obstacles: Parameters<typeof chooseMobileAvatarPaint>[3] = [],
  felt = awayFelt,
  ceiling = 1.15
) => chooseMobileAvatarPaint(art, [60, 80], Infinity, obstacles, felt, viewport, ceiling);

describe('mobile avatar paint fitting', () => {
  it('uses free rail space with a uniform scale', () => {
    const result = choose();
    expect(result.scale).toBe(1.15);
    expect(result.parts[0].width / art[0].width).toBeCloseTo(
      result.parts[0].height / art[0].height
    );
  });
  it('refuses extra coverage of a protected object', () => {
    expect(choose([{ box: viewport, ownLayer: false }]).scale).toBe(1);
  });
  it('allows only the explicitly permitted existing own-layer overlap', () => {
    expect(choose([{ box: viewport, ownLayer: true }]).scale).toBe(1.15);
    const obstacle = { left: 80, top: 0, width: 220, height: 400 };
    const result = choose([{ box: obstacle, ownLayer: true }]);
    expect(result.parts.every((p) => p.left + p.width <= obstacle.left)).toBe(true);
  });
  it('grows over the felt rim: the felt is a surface, not a feature (Dan 2026-11-12)', () => {
    expect(choose([], { left: 0, top: 0, width: 120, height: 300 }).scale).toBe(1.15);
  });
  it('still refuses to cover a bet stack reserved on the felt', () => {
    const betStack = { left: 40, top: 20, width: 40, height: 20 };
    const result = choose([{ box: betStack, ownLayer: false }], {
      left: 0,
      top: 0,
      width: 120,
      height: 300,
    });
    expect(
      result.parts.every(
        (p) =>
          p.left + p.width <= betStack.left ||
          p.left >= betStack.left + betStack.width ||
          p.top + p.height <= betStack.top ||
          p.top >= betStack.top + betStack.height
      )
    ).toBe(true);
  });
  it('can reach the 2.5x ceiling when nothing is in the way', () => {
    expect(choose([], awayFelt, 2.5).scale).toBe(2.5);
  });
  it('honors the hero size ceiling and missing paint', () => {
    expect(choose([], awayFelt, 1.05).scale).toBe(1.05);
    expect(choose([], awayFelt, 1.01).scale).toBe(1);
    expect(chooseMobileAvatarPaint([], [0, 0], Infinity, [], awayFelt, viewport).scale).toBe(1);
  });
  it('keeps a clipped torso inside its original lower edge', () => {
    const result = chooseMobileAvatarPaint(art, [60, 80], 80, [], awayFelt, viewport);
    expect(result.scale).toBeGreaterThan(1);
    expect(result.parts.every((p) => p.top + p.height <= 80)).toBe(true);
  });
  it('never qualifies enlargement by clipping away the character', () => {
    for (const scale of [1.3, 1.9, 2]) {
      const result = chooseMobileAvatarPaint(
        art,
        [60, 80],
        80,
        [],
        awayFelt,
        viewport,
        2,
        Infinity,
        { scale, px: 0, py: -1 }
      );
      expect(result.scale).toBe(1);
      expect(result.parts).toEqual(art);
    }
  });
  it('refuses a sideways zoom whose visible centre leaves the original portrait', () => {
    expect(
      chooseMobileAvatarPaint(art, [60, 80], 80, [], awayFelt, viewport, 2, Infinity, {
        scale: 2,
        px: 0.3,
        py: 0,
      }).scale
    ).toBe(1);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses baseline on first mount and exact retained paint for later reveals', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const page = document.createElement('div');
    Object.assign(page.dataset, {
      seats: '6',
      hero: 'false',
      killEnabled: 'false',
      holeCardCount: '4',
    });
    page.innerHTML =
      '<div class="table-scaler"><div class="seat-wrapper" style="left:50%;top:100%"><div class="seat"><div class="seat__avatar seat__avatar--bust"><img class="seat__avatar-img"></div></div></div></div>';
    const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
    const image = page.querySelector('img')!;
    const state = createMobilePaintState();
    expect(mobileAvatarCardReservation(image, art[0], scaler, page, state)).toEqual(art[0]);
    state.key = mobilePaintKey(scaler, page);
    state.choices.set(image, {
      scale: 2,
      x: 0,
      y: 0,
      parts: [{ left: 40, top: 30, width: 40, height: 50 }],
      origin: [0, 0],
    });
    expect(mobileAvatarCardReservation(image, art[0], scaler, page, state)).toEqual({
      left: 40,
      top: 30,
      width: 40,
      height: 50,
    });
  });

  it('enlargeMobileFrames exports --sp-frame-bw, stays idempotent on repeat calls, and clears cleanly on reset', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('innerWidth', 600);
    vi.stubGlobal('innerHeight', 1065);
    const page = document.createElement('div');
    page.className = 'table-page';
    page.innerHTML =
      '<div class="table-surface"></div><div class="table-scaler"><div class="seat seat--hero"><div class="seat__info"></div></div></div>';
    const surface = page.querySelector<HTMLElement>('.table-surface')!;
    const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
    const info = page.querySelector<HTMLElement>('.seat__info')!;
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(rect(20, 20, 560, 1025));
    vi.spyOn(scaler, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 1065));
    vi.spyOn(info, 'getBoundingClientRect').mockReturnValue(rect(250, 700, 100, 54));

    // Mirror SeatSlot.css: when --sp-frame-w is present, .seat__info itself has
    // transparent background/border. Repeat calls to enlargeMobileFrames MUST strip
    // frameProperties before reading getComputedStyle(info) so it never captures
    // transparent into --sp-frame-background / --sp-frame-border.
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (el === info && !pseudo) {
        const hasFrame = Boolean(info.style.getPropertyValue('--sp-frame-w'));
        return {
          borderLeftWidth: '1.5px',
          borderTopWidth: '1.5px',
          background: hasFrame ? 'rgba(0, 0, 0, 0)' : 'rgba(10, 10, 14, 0.95)',
          border: hasFrame ? '1.5px solid rgba(0, 0, 0, 0)' : '1.5px solid rgba(255, 215, 0, 0.25)',
          borderRadius: '10px',
          boxShadow: hasFrame ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.5)',
          transform: 'none',
        } as unknown as CSSStyleDeclaration;
      }
      return realGetComputedStyle(el, pseudo);
    });

    const state = createMobilePaintState();
    state.obstacles = [];
    enlargeMobileFrames(scaler, page, new Map(), state);
    expect(info.style.getPropertyValue('--sp-frame-w')).not.toBe('');
    expect(info.style.getPropertyValue('--sp-frame-bw')).toBe('1.5px');
    expect(info.style.getPropertyValue('--sp-frame-background')).toBe('rgba(10, 10, 14, 0.95)');
    expect(info.style.getPropertyValue('--sp-frame-border')).toBe(
      '1.5px solid rgba(255, 215, 0, 0.25)'
    );

    // Repeat call while already enlarged must NOT capture transparent.
    enlargeMobileFrames(scaler, page, new Map(), state);
    expect(info.style.getPropertyValue('--sp-frame-bw')).toBe('1.5px');
    expect(info.style.getPropertyValue('--sp-frame-background')).toBe('rgba(10, 10, 14, 0.95)');
    expect(info.style.getPropertyValue('--sp-frame-border')).toBe(
      '1.5px solid rgba(255, 215, 0, 0.25)'
    );

    // Reset removes --sp-frame-bw along with the rest of the frame properties.
    resetMobileAvatarPaint(scaler);
    expect(info.style.getPropertyValue('--sp-frame-w')).toBe('');
    expect(info.style.getPropertyValue('--sp-frame-bw')).toBe('');
    expect(info.style.getPropertyValue('--sp-frame-background')).toBe('');
  });
});
