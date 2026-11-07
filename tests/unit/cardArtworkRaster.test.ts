import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import {
  cardArtworkCrop,
  selectCardArtworkFrame,
  startCardArtworkRaster,
} from '../e2e/support/cardArtworkRaster';

const meta = {
  deviceWidth: 400,
  deviceHeight: 800,
  pageScaleFactor: 1,
  offsetTop: 0,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
};
const bounds = { x: 10.2, y: 20.2, width: 40.6, height: 60.6 };

describe('bounded compositor frame admission', () => {
  it('selects the earliest retained frame at or after exposure with its measured delay', () => {
    const frames = [{ at: 1000 }, { at: 1016 }, { at: 1032 }];
    expect(selectCardArtworkFrame(frames, 1005)).toEqual({
      frame: frames[1],
      index: 1,
      delayMs: 11,
    });
  });
  it('admits a legitimate idle compositor interval only with a recent DOM baseline', () => {
    const frames = [{ at: 1000 }, { at: 3000 }];
    expect(selectCardArtworkFrame(frames, 2985, 2970)).toEqual({
      frame: frames[1],
      index: 1,
      delayMs: 15,
    });
    expect(selectCardArtworkFrame([{ at: 3000 }], 2985, 2970)).toEqual({
      reason: 'missing-before-exposure-frame',
    });
  });
  it('does not explain an idle gap with an invalid or stale DOM interval or admit late raster delivery', () => {
    const frames = [{ at: 1000 }, { at: 3000 }];
    for (const previous of [undefined, null, NaN, Infinity, 0, 990, 2800, 2985, 2990]) {
      expect(selectCardArtworkFrame(frames, 2985, previous)).toEqual({
        reason: 'compositor-frame-gap',
      });
    }
    expect(selectCardArtworkFrame([{ at: 1000 }, { at: 3200 }], 2985, 2970)).toEqual({
      reason: 'compositor-frame-gap',
    });
  });
  it('does not infer coverage from missing timestamps, absent brackets or gaps', () => {
    expect(selectCardArtworkFrame([{ at: NaN }, { at: 1020 }], 1005)).toEqual({
      reason: 'invalid-timestamp',
    });
    expect(selectCardArtworkFrame([{ at: 1020 }], 1005)).toEqual({
      reason: 'missing-before-exposure-frame',
    });
    expect(selectCardArtworkFrame([{ at: 1000 }], 1005)).toEqual({
      reason: 'no-frame-after-exposure',
    });
    expect(selectCardArtworkFrame([{ at: 900 }, { at: 1020 }], 1005)).toEqual({
      reason: 'compositor-frame-gap',
    });
    expect(selectCardArtworkFrame([{ at: 1020 }, { at: 1000 }], 1005)).toEqual({
      reason: 'invalid-timestamp',
    });
  });
});

describe('public card crop validation', () => {
  it('scales uniformly and rounds inward so adjacent viewport pixels are excluded', () => {
    expect(cardArtworkCrop(bounds, 800, 1600, meta)).toEqual({
      left: 21,
      top: 41,
      width: 80,
      height: 120,
    });
  });
  it('rejects unproved scale, offsets, scroll, partial bounds, empty crops and invalid dimensions', () => {
    for (const invalid of [
      { ...meta, pageScaleFactor: 2 },
      { ...meta, offsetTop: 1 },
      { ...meta, scrollOffsetY: 1 },
      { ...meta, deviceWidth: NaN },
      { ...meta, deviceHeight: 0 },
    ])
      expect(cardArtworkCrop(bounds, 400, 800, invalid)).toBeNull();
    expect(cardArtworkCrop(bounds, 400, 700, meta)).toBeNull();
    expect(cardArtworkCrop({ ...bounds, x: -1 }, 400, 800, meta)).toBeNull();
    expect(cardArtworkCrop({ ...bounds, x: 390 }, 400, 800, meta)).toBeNull();
    expect(cardArtworkCrop({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 400, 800, meta)).toBeNull();
    expect(cardArtworkCrop(bounds, 8000, 16000, meta)).toBeNull();
  });
});

describe('actual bounded CDP capture lifecycle', () => {
  async function fixture() {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    let listener: (event: unknown) => void = () => {};
    const commands: string[] = [];
    const session = {
      on: (_event: string, callback: typeof listener) => {
        listener = callback;
      },
      send: async (command: string) => {
        commands.push(command);
      },
      detach: async () => {},
    };
    const page = { context: () => ({ newCDPSession: async () => session }) } as unknown as Page;
    const raster = await startCardArtworkRaster(page);
    return {
      raster,
      commands,
      emit(at: number) {
        listener({
          sessionId: 1,
          data: png.toString('base64'),
          metadata: {
            ...meta,
            deviceWidth: 4,
            deviceHeight: 4,
            timestamp: at / 1000,
          },
        });
      },
      exposure: {
        id: 'public-board',
        firstEligibleAt: 1005,
        bounds: { x: 1, y: 1, width: 2, height: 2 },
      },
    };
  }
  it('keeps the actual preceding frame through25 later60Hz frames before capture', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i <= 25; i++) f.emit(1000 + i * (1000 / 60));
      const [result] = await f.raster.capture([f.exposure]);
      expect(result.verdict).toBe('captured');
      expect(result.delayMs).toBeCloseTo(1000 / 60 - 5);
      expect(await sharp(result.image!).metadata()).toMatchObject({ width: 2, height: 2 });
      expect(f.commands.filter((c) => c === 'Page.screencastFrameAck')).toHaveLength(26);
    } finally {
      await f.raster.stop();
    }
  });
  it('pins entry frames before a wait whose64-frame burst prunes the preceding frame', async () => {
    const f = await fixture();
    try {
      f.emit(1000);
      const pending = f.raster.capture([f.exposure]);
      const concurrent = await f.raster.capture([f.exposure]);
      expect(concurrent[0].reason).toBe('capture-already-active');
      for (let i = 1; i <= 64; i++) f.emit(1000 + i * (1000 / 60));
      const [result] = await pending;
      expect(result.verdict).toBe('captured');
      expect(result.delayMs).toBeCloseTo(1000 / 60 - 5);
      expect(await sharp(result.image!).metadata()).toMatchObject({ width: 2, height: 2 });
    } finally {
      await f.raster.stop();
    }
  });
});
