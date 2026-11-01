import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_CROWN_TOP,
  avatarCrownTop,
  paintedAvatarTop,
  restingAvatarTop,
  restingAvatarBox,
  tableRenderScale,
} from '../../src/components/table/avatarCrownBounds';

describe('visible avatar crowns', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('covers normal and retina library art with measured fractions', () => {
    expect(Object.keys(AVATAR_CROWN_TOP)).toHaveLength(200);
    expect(Object.values(AVATAR_CROWN_TOP).every((top) => top >= 0 && top < 0.5)).toBe(true);
  });
  it('uses the actual tech-mogul headroom seen on limplegend, including URL suffixes', () => {
    // Shipped 250x340 art: first alpha >=16 occurs at row 54, independently measured.
    expect(
      avatarCrownTop('https://smarter.poker/avatars/table/vip_tech_mogul@2x.webp?v=1#avatar')
    ).toBeCloseTo(54 / 340, 6);
  });
  it('preserves the image boundary for unknown or uploaded art', () => {
    for (const source of [
      null,
      undefined,
      '',
      '/avatars/table/vip_new.webp',
      '/uploads/avatar.png',
    ])
      expect(avatarCrownTop(source)).toBe(0);
  });
  it('projects the crown through the rendered image scale', () => {
    const image = document.createElement('img');
    image.src = '/avatars/table/vip_tech_mogul@2x.webp';
    image.getBoundingClientRect = () => ({ top: 100, height: 200 }) as DOMRect;
    expect(paintedAvatarTop(image)).toBeCloseTo(100 + 200 * (54 / 340), 3);
  });
  it('anchors from layout and static bust framing, independent of gesture and active scale', () => {
    vi.stubGlobal(
      'DOMMatrix',
      class {
        a: number;
        b: number;
        c: number;
        d: number;
        e: number;
        f: number;
        constructor(transform: string) {
          const values = transform
            .replace(/^matrix\(|\)$/g, '')
            .split(',')
            .map(Number);
          this.a = values[0];
          this.b = values[1];
          this.c = values[2];
          this.e = values[4];
          this.d = values[3];
          this.f = values[5];
        }
      }
    );
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.innerHTML =
      '<div class="seat__avatar-wrap"><div class="seat__avatar"><img class="seat__avatar-img" /></div></div>';
    document.body.append(seat);
    const wrap = seat.firstElementChild as HTMLElement;
    const avatar = wrap.firstElementChild as HTMLElement;
    const image = avatar.firstElementChild as HTMLImageElement;
    image.src = '/avatars/table/vip_tech_mogul@2x.webp';
    image.style.transform = 'matrix(1.45, 0, 0, 1.45, 0, 0)';
    image.style.transformOrigin = '50px 100px';
    avatar.style.transform = 'scale(1.08)';
    wrap.style.transform = 'translateY(-10px) scale(1.09)';
    seat.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    image.getBoundingClientRect = () => ({ top: -900, height: 500 }) as DOMRect;
    Object.defineProperty(image, 'offsetHeight', { value: 100 });
    Object.defineProperty(image, 'offsetWidth', { value: 100 });
    for (const [element, parent, top] of [
      [image, avatar, 0],
      [avatar, wrap, 0],
      [wrap, seat, 10],
    ] as const) {
      Object.defineProperty(element, 'offsetParent', { value: parent });
      Object.defineProperty(element, 'offsetTop', { value: top });
    }
    expect(restingAvatarTop(image, 0.75)).toBeCloseTo(
      100 + (10 + 100 + (100 * (54 / 340) - 100) * 1.45) * 0.75,
      3
    );
    wrap.style.transform = 'translateY(3px) scale(.97)';
    expect(restingAvatarTop(image, 0.75)).toBeCloseTo(
      100 + (10 + 100 + (100 * (54 / 340) - 100) * 1.45) * 0.75,
      3
    );
    wrap.style.transformOrigin = '50px 50px';
    wrap.style.setProperty('--sp-avatar-rest-transform', 'matrix(0.97, 0, 0, 0.97, 0, 3)');
    expect(restingAvatarTop(image, 0.75)).toBeCloseTo(
      100 + (10 + 50 + (100 + (100 * (54 / 340) - 100) * 1.45 - 50) * 0.97 + 3) * 0.75,
      3
    );
    const computed = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      const style = computed(element);
      return element === avatar
        ? new Proxy(style, {
            get: (target, key) => (key === 'scale' ? '1.2' : Reflect.get(target, key, target)),
          })
        : style;
    });
    const permanent = restingAvatarBox(image, 0.75);
    expect(permanent.height).toBeCloseTo(100 * 1.45 * 1.2 * 0.97 * 0.75, 3);
    wrap.style.transform = 'translateY(-99px) scale(1.6)';
    expect(restingAvatarBox(image, 0.75).height).toBeCloseTo(permanent.height, 6);
    seat.remove();
  });
});

describe('fractional table layout projection', () => {
  it('keeps an untransformed fractional canvas at scale one', () => {
    const canvas = document.createElement('div');
    document.body.append(canvas);
    canvas.style.width = '262.390625px';
    Object.defineProperty(canvas, 'offsetWidth', { value: 262 });
    canvas.getBoundingClientRect = () => ({ width: 262.390625 }) as DOMRect;
    expect(tableRenderScale(canvas)).toBe(1);
    canvas.remove();
  });
  it('preserves a real transform and content-box edges', () => {
    const canvas = document.createElement('div');
    document.body.append(canvas);
    canvas.style.cssText =
      'width:262.390625px;padding:0 2px;border:1px solid black;box-sizing:content-box';
    canvas.getBoundingClientRect = () => ({ width: 134.1953125 }) as DOMRect;
    expect(tableRenderScale(canvas)).toBe(0.5);
    canvas.remove();
  });
});
