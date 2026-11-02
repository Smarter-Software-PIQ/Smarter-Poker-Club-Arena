import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AVATAR_CROWN_TOP,
  avatarCrownTop,
  paintedAvatarTop,
  restingAvatarTop,
  restingAvatarBox,
  tableRenderScale,
  permanentAvatarFocusScale,
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
  it('keeps permanent artwork fixed through attention and winner states', () => {
    const avatarCss = readFileSync(
      resolve(process.cwd(), 'src/components/table/SeatSlot.css'),
      'utf8'
    );
    const tableCss = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.css'), 'utf8');
    expect(avatarCss).toMatch(
      /\.table-page \.seat \.seat__avatar\s*\{[^}]*transform:\s*none !important/
    );
    expect(tableCss).toMatch(
      /\.seat-wrapper--spot \.seat:not\(\.seat--empty\)\s*\{[^}]*transform:\s*none/
    );
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="seat"><div class="seat__avatar"><img /></div></div>';
    const seat = wrapper.firstElementChild!;
    const image = wrapper.querySelector('img')!;
    expect(permanentAvatarFocusScale(image)).toBe(1);
    seat.classList.add('seat--active');
    expect(permanentAvatarFocusScale(image)).toBe(1);
    wrapper.classList.add('seat-wrapper--spot');
    expect(permanentAvatarFocusScale(image)).toBe(1);
    seat.classList.remove('seat--active');
    expect(permanentAvatarFocusScale(image)).toBe(1);
    wrapper.classList.remove('seat-wrapper--spot');
    seat.classList.add('seat--winner');
    expect(permanentAvatarFocusScale(image)).toBe(1);
  });
  it('pins table character motion without suppressing cards, chips or status cues', () => {
    const choreography = readFileSync(
      resolve(process.cwd(), 'src/components/table/avatarChoreography.css'),
      'utf8'
    );
    const fixed = choreography.slice(choreography.lastIndexOf('.table-page .seat__avatar-wrap {'));
    expect(fixed).toContain('--sp-avatar-rest-transform: none');
    expect(fixed).toContain('animation: none !important');
    expect(fixed).toContain('transform: none !important');
    expect(fixed).toContain('scale: 1 !important');
    const seatCss = readFileSync(
      resolve(process.cwd(), 'src/components/table/SeatSlot.css'),
      'utf8'
    );
    expect(seatCss).toMatch(
      /\.table-page \.seat:not\(\.seat--empty\)\s*\{[^}]*translate:\s*var\(--sp-opponent-x, 0px\) var\(--sp-opponent-y, 0px\) !important;[^}]*rotate:\s*0deg !important/
    );
    expect(fixed).not.toMatch(/seat__cards|seat__bet-chips|seat__info/);
  });
  it('preserves static bust framing without attention or temporary gesture gains', () => {
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
          [this.a, this.b, this.c, this.d, this.e, this.f] = values;
        }
      }
    );
    const wrapper = document.createElement('div');
    wrapper.className = 'seat-wrapper seat-wrapper--spot';
    wrapper.innerHTML =
      '<div class="seat seat--active"><div class="seat__avatar-wrap"><div class="seat__avatar"><img class="seat__avatar-img" /></div></div></div>';
    document.body.append(wrapper);
    const seat = wrapper.firstElementChild as HTMLElement;
    const wrap = seat.firstElementChild as HTMLElement;
    const avatar = wrap.firstElementChild as HTMLElement;
    const image = avatar.firstElementChild as HTMLImageElement;
    image.style.transform = 'matrix(1.6849, 0, 0, 1.6849, 0, 0)';
    image.style.transformOrigin = '26px 52px';
    avatar.style.transform = 'matrix(1.04, 0, 0, 1.04, 0, 0)';
    avatar.style.transformOrigin = '26px 52px';
    avatar.style.scale = '2.105296';
    seat.style.transform = 'matrix(1.04, 0, 0, 1.04, 0, 0)';
    seat.getBoundingClientRect = () => new DOMRect(62.369373, 905.019287, 116.48, 87.668762);
    for (const [element, parent] of [
      [image, avatar],
      [avatar, wrap],
      [wrap, seat],
    ] as const) {
      Object.defineProperty(element, 'offsetParent', { value: parent });
      Object.defineProperty(element, 'offsetWidth', { value: 52 });
      Object.defineProperty(element, 'offsetHeight', { value: 52 });
    }
    Object.defineProperty(wrap, 'offsetLeft', { value: 30 });
    const computed = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      const style = computed(element);
      return element === avatar
        ? new Proxy(style, {
            get: (target, key) => (key === 'scale' ? '2.105296' : Reflect.get(target, key, target)),
          })
        : style;
    });
    // Independent composition of the unchanged 52px slot, bust image and
    // opponent paint scale. Turn focus no longer adds another scale.
    const permanent = restingAvatarBox(image, 1);
    const fixedSize = 52 * 1.6849 * 2.105296;
    expect(permanent.height).toBeCloseTo(fixedSize, 6);
    expect(permanent.width).toBeCloseTo(fixedSize, 6);
    expect(permanent.left).toBeCloseTo(62.369373 + 30 + 26 - fixedSize / 2, 6);
    expect(permanent.top).toBeCloseTo(905.019287 + 52 - fixedSize, 6);
    // A temporary gesture and winner glow must not become permanent sizing.
    wrap.style.transform = 'matrix(1.6, 0, 0, 1.6, 0, -99)';
    avatar.style.transform = 'matrix(1.08, 0, 0, 1.08, 0, 0)';
    seat.classList.add('seat--winner');
    expect(restingAvatarBox(image, 1).height).toBeCloseTo(permanent.height, 6);
    wrapper.remove();
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
