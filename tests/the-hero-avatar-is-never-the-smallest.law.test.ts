import { describe, expect, it, vi } from 'vitest';
import {
  createOpponentAvatarLayout,
  type OpponentAvatarState,
} from '../src/components/table/opponentAvatarLayout';

/**
 * THE HERO'S AVATAR IS NEVER THE SMALLEST ONE AT THE TABLE (Dan, 2026-11-09)
 *
 * Dan, with a PLO4 Lightning screenshot: "the 'hero' avatar is smaller then all
 * the other avatars at the table, it should always be the same size."
 *
 * `--sp-opponent-art-scale` normalises each opponent's painted subject to the
 * hero's, and `.seat__avatar` consumes it - so the factor also decides how big
 * the opponent's VISIBLE CIRCLE is: the 2.5px ring, the gradient backing and
 * the portrait all grow together. Measured with
 * scripts/dev/measure-seat-avatar-art.mjs, 9-max at 375px:
 *
 *   declared hero circle    66.67px      declared opponent circle   37.66px
 *   character-art hero      factor 1.7709 -> opponent circle 66.68px
 *   photo hero              factor 1.9871 -> opponent circle 74.80px  (+12.2%)
 *
 * Every e2e scene gives the hero character art, whose painted subject carries
 * transparent margins, so the factor landed the opponent circle on the hero's
 * to within 0.02px and nothing ever saw this. A human player has a PHOTOGRAPH -
 * opaque edge to edge, so its painted subject IS its whole circle - the target
 * grows, and every opponent circle outgrows the hero's on every phone width.
 *
 * The law: an opponent's rendered circle may equal the hero's and may be
 * smaller. It may never be larger. The two cases below are the photograph that
 * made the cap bind and the character art that must not be disturbed by it.
 */
const HERO_CIRCLE = 66.67;
const OPPONENT_CIRCLE = 37.66;

const mount = (heroFills: boolean) => {
  const page = document.createElement('div');
  page.className = 'table-page';
  page.innerHTML =
    `<div class="table-scaler">` +
    `<div class="seat-wrapper seat-wrapper--hero"><div class="seat seat--hero" data-player-id="hero">` +
    `<div class="seat__avatar${heroFills ? '' : ' seat__avatar--bust'}" style="width:${HERO_CIRCLE}px;height:${HERO_CIRCLE}px">` +
    `<img class="seat__avatar-img" /></div></div></div>` +
    `<div class="seat-wrapper"><div class="seat" data-player-id="villain-1">` +
    `<div class="seat__avatar seat__avatar--bust" style="width:${OPPONENT_CIRCLE}px;height:${OPPONENT_CIRCLE}px">` +
    `<img class="seat__avatar-img" /></div>` +
    `<div class="seat__info" style="width:112px;height:36px"></div></div></div></div>`;
  document.body.append(page);
  const images = [...page.querySelectorAll<HTMLImageElement>('img')];
  images.forEach((image, i) => {
    image.src = `https://example.invalid/hero-circle-${heroFills ? 'photo' : 'art'}-${i ? 'opponent' : 'hero'}.webp`;
    image.style.transform = 'none';
    // A photograph is cropped to fill its circle; character art is contained
    // and stands on the slot's bottom edge.
    image.style.objectFit = i === 0 && heroFills ? 'cover' : 'contain';
    image.style.objectPosition = i === 0 && heroFills ? '50% 50%' : '50% 100%';
    for (const [name, value] of Object.entries({
      complete: true,
      naturalWidth: 250,
      naturalHeight: 340,
      offsetWidth: 80,
      offsetHeight: 80,
    }))
      Object.defineProperty(image, name, { configurable: true, value });
  });
  /* The hero's portrait decodes opaque edge to edge when it is a photograph,
     and with the same margins as the opponent when it is character art. The
     opponent's subject is deliberately a narrow band, so an uncapped match
     would ask for 3.4x - far past the hero's own circle. */
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let source: HTMLImageElement;
    return {
      drawImage: (image: HTMLImageElement) => {
        source = image;
      },
      getImageData: () => {
        const data = new Uint8ClampedArray(250 * 340 * 4);
        const hero = source.src.endsWith('hero.webp');
        const from = hero && heroFills ? 0 : 150;
        const to = hero && heroFills ? 340 : 250;
        for (let y = from; y < to; y++)
          for (let x = 0; x < 250; x++) data[(y * 250 + x) * 4 + 3] = 255;
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  });
  return { page, images, canvas };
};

const settle = async (page: HTMLElement) => {
  const scaler = page.querySelector<HTMLElement>('.table-scaler')!;
  const state: OpponentAvatarState = { key: '', shifts: new WeakMap() };
  const layout = createOpponentAvatarLayout(scaler, page, state, vi.fn());
  layout.prepare();
  await Promise.resolve();
  await Promise.resolve();
  layout.prepare();
  return layout;
};

describe('the hero avatar is never the smallest one at the table', () => {
  it('caps a photo hero so no opponent circle grows past the hero', async () => {
    const { page, images, canvas } = mount(true);
    const layout = await settle(page);
    try {
      const applied = Number(
        images[1]
          .closest<HTMLElement>('.seat__avatar')!
          .style.getPropertyValue('--sp-opponent-art-scale')
      );
      // The uncapped match would be 80 / 23.53 = 3.4x.
      expect(applied).toBeGreaterThan(1);
      expect(applied).toBeLessThan(3);
      expect(applied).toBeCloseTo(HERO_CIRCLE / OPPONENT_CIRCLE, 5);
      // What the player sees: the two circles are the same size, and the
      // opponent's is never the larger of the two.
      expect(OPPONENT_CIRCLE * applied).toBeLessThanOrEqual(HERO_CIRCLE + 0.01);
      expect(OPPONENT_CIRCLE * applied).toBeCloseTo(HERO_CIRCLE, 2);
      // The hero itself is the reference and is never scaled.
      expect(
        images[0]
          .closest<HTMLElement>('.seat__avatar')!
          .style.getPropertyValue('--sp-opponent-art-scale')
      ).toBe('');
    } finally {
      layout.stop();
      canvas.mockRestore();
      page.remove();
    }
  });

  it('leaves a character-art table on its exact subject match', async () => {
    const { page, images, canvas } = mount(false);
    const layout = await settle(page);
    try {
      const applied = Number(
        images[1]
          .closest<HTMLElement>('.seat__avatar')!
          .style.getPropertyValue('--sp-opponent-art-scale')
      );
      // Identical decoded subjects, so the match is 1x and the cap - which
      // would have allowed up to 1.77x - changes nothing.
      expect(applied).toBeCloseTo(1, 5);
      expect(OPPONENT_CIRCLE * applied).toBeLessThanOrEqual(HERO_CIRCLE + 0.01);
    } finally {
      layout.stop();
      canvas.mockRestore();
      page.remove();
    }
  });
});
