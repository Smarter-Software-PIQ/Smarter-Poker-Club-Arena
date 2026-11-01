import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';
import SeatSlot from '../../src/components/table/SeatSlot';
import {
  containedBustGain,
  generatedBustMeasurements,
  isGeneratedBustUrl,
  measureGeneratedBust,
  rememberGeneratedBust,
} from '../../src/components/table/customBustArt';

describe('generated character avatars share the library subject height', () => {
  it('recognizes original and resized generated PNGs without changing photographs', () => {
    for (const path of ['object', 'render/image']) {
      expect(
        isGeneratedBustUrl(
          `https://example.test/storage/v1/${path}/public/custom-avatars/generated/character.png?width=224`
        )
      ).toBe(true);
    }
    expect(
      isGeneratedBustUrl('https://example.test/storage/v1/object/public/avatars/photo.png')
    ).toBe(false);
    expect(isGeneratedBustUrl('data:image/svg+xml;base64,example')).toBe(false);
  });

  it('fits the actual KingFish landscape alpha bounds to the same visible height', () => {
    // Read from the reported public generated PNG: 1296x864, alpha y19..864.
    // object-fit: contain fits its width, so height-only normalization was wrong.
    const gain = containedBustGain(1296, 864, 19, 864);
    expect(((864 - 19) / 1296) * gain * 1.45).toBeCloseTo(0.888 * 1.45, 10);
    // The existing storage resize may supply a square crop instead. It uses
    // the same measured-pixel rule rather than a hero-specific multiplier.
    const resizedGain = containedBustGain(224, 224, 5, 224);
    expect(((224 - 5) / 224) * resizedGain * 1.45).toBeCloseTo(0.888 * 1.45, 10);
  });

  it('keeps the full nine-seat ring at the existing one-slot hero height', () => {
    const css = readFileSync('src/components/table/SeatSlot.css', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    const shared = css.match(/\.table-page\[data-seats='9'\] \.seat-wrapper\s*\{([^}]+)\}/)?.[1];
    const scale = Number(shared?.match(/--sp-bust-scale:\s*([\d.]+)/)?.[1]);
    expect(scale * 0.888).toBeCloseTo(1, 5);
    // The old custom hero had a square crop with two transparent top pixels.
    // Normalization retains that size within one pixel at the 80px hero slot.
    expect(Math.abs((scale * 0.888 - 222 / 224) * 80)).toBeLessThan(1);
  });

  it('keeps invalid or unreadable images visible through the original path', () => {
    expect(containedBustGain(0, 20, 0, 10)).toBe(1);
    expect(containedBustGain(20, 20, 20, 20)).toBe(1);
    expect(
      measureGeneratedBust({ naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement)
    ).toBeUndefined();
  });

  it('retains bounded measurements by avatar URL rather than by hero or chair', () => {
    generatedBustMeasurements.clear();
    rememberGeneratedBust('same-character', 0.91);
    expect(generatedBustMeasurements.get('same-character')).toBe(0.91);
    expect(generatedBustMeasurements.has('new-character')).toBe(false);
    for (let i = 0; i < 256; i++) rememberGeneratedBust(`character-${i}`, 1);
    expect(generatedBustMeasurements.size).toBe(256);
    expect(generatedBustMeasurements.has('same-character')).toBe(false);
    generatedBustMeasurements.clear();
  });

  it('applies the measured gain through the real seat and keeps its CORS fallback visible', () => {
    generatedBustMeasurements.clear();
    const pixels = new Uint8ClampedArray(224 * 224 * 4);
    for (let y = 2; y < 224; y++) pixels[(y * 224 + 112) * 4 + 3] = 255;
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
    } as unknown as CanvasRenderingContext2D);
    const view = render(
      createElement(SeatSlot, {
        seatNumber: 1,
        player: {
          id: 'generated-avatar-player',
          name: 'Player',
          avatar:
            'https://example.test/storage/v1/object/public/custom-avatars/generated/character.png',
          stack: 25000,
          status: 'active',
          isHero: true,
        },
        position: null,
        isActive: false,
        lastAction: null,
      })
    );
    try {
      const image = view.container.querySelector<HTMLImageElement>('.seat__avatar-img')!;
      Object.defineProperties(image, {
        naturalWidth: { value: 224 },
        naturalHeight: { value: 224 },
      });
      expect(image.crossOrigin).toBe('anonymous');
      fireEvent.load(image);
      const avatar = view.container.querySelector<HTMLElement>('.seat__avatar')!;
      expect(avatar.classList.contains('seat__avatar--bust')).toBe(true);
      expect(Number(avatar.style.getPropertyValue('--sp-bust-gain'))).toBeCloseTo(0.896, 6);
      fireEvent.error(image);
      expect(image.getAttribute('crossorigin')).toBeNull();
      expect(view.container.querySelector('.seat__avatar-img')).toBe(image);
      expect(avatar.classList.contains('seat__avatar--bust')).toBe(false);
    } finally {
      view.unmount();
      context.mockRestore();
      generatedBustMeasurements.clear();
    }
  });
});
