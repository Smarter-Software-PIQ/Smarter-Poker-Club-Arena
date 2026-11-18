import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/hooks/useDeckStyle', () => ({ getDeckStyle: () => '4color' }));

let instances: FakeImage[];
let rejectWebp = false;
let rejectAll = false;
let finishDecode: (() => void)[];
class FakeImage {
  naturalWidth = 360;
  naturalHeight = 504;
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  value = '';
  constructor() {
    instances.push(this);
  }
  set src(url: string) {
    this.value = url;
    queueMicrotask(() => {
      if (rejectAll || (rejectWebp && url.endsWith('.webp'))) this.onerror?.();
      else this.onload?.();
    });
  }
  get src() {
    return this.value;
  }
  decode() {
    return new Promise<void>((resolve) => finishDecode.push(resolve));
  }
}
async function drain() {
  for (let i = 0; i < 300; i++) {
    await Promise.resolve();
    finishDecode.splice(0).forEach((finish) => finish());
  }
}
beforeEach(() => {
  vi.resetModules();
  instances = [];
  finishDecode = [];
  rejectWebp = false;
  rejectAll = false;
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (rejectAll || (rejectWebp && url.endsWith('.webp'))) throw new Error('network');
      return { ok: true, blob: async () => new Blob([url]) };
    })
  );
  let id = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:card-${id++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('full deck paint readiness', () => {
  it('paints the retained decoded pixels synchronously into every new mounted surface', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    const load = deck.prepareDeckImages('4color');
    await drain();
    await load;
    const requests = vi.mocked(fetch).mock.calls.length;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const url = deck.deckImageUrls('4color')[0];
    for (let mount = 0; mount < 2; mount++) {
      const canvas = document.createElement('canvas');
      expect(deck.drawDecodedCardImage(url, canvas)).toBe(true);
      expect(canvas.dataset.cardArtworkReady).toBe('true');
      expect([canvas.width, canvas.height]).toEqual([360, 504]);
      expect(drawImage).toHaveBeenLastCalledWith(instances[0], 0, 0, 360, 504);
    }
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
    expect(instances).toHaveLength(52);
  });
  it('filters court artwork at display density instead of shrinking a native canvas', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    const load = deck.prepareDeckImages('4color');
    await drain();
    await load;
    const context = {
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    );
    const canvas = document.createElement('canvas');
    Object.defineProperties(canvas, { clientWidth: { value: 65 }, clientHeight: { value: 91 } });
    const density = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1);
    const url = deck.deckImageUrls('4color')[0];
    for (const dpr of [1, 2, 3]) {
      density.mockReturnValue(dpr);
      expect(deck.drawDecodedCardImage(url, canvas)).toBe(true);
      expect([canvas.width, canvas.height]).toEqual([65 * dpr, 91 * dpr]);
      expect(context.imageSmoothingEnabled).toBe(true);
      expect(context.imageSmoothingQuality).toBe('high');
      expect(context.drawImage).toHaveBeenLastCalledWith(instances[0], 0, 0, 65 * dpr, 91 * dpr);
    }
  });
  it('clears stale pixels and readiness for unavailable sources and failed draws', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    const load = deck.prepareDeckImages('4color');
    await drain();
    await load;
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement('canvas');
    const url = deck.deckImageUrls('4color')[0];
    expect(deck.drawDecodedCardImage(url, canvas)).toBe(true);
    expect(deck.drawDecodedCardImage('unavailable', canvas)).toBe(false);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(canvas.dataset.cardArtworkReady).toBeUndefined();
    getContext.mockReturnValue(null);
    expect(deck.drawDecodedCardImage(url, canvas)).toBe(false);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(canvas.dataset.cardArtworkReady).toBeUndefined();
    getContext.mockReturnValue({
      drawImage: () => {
        throw new Error('draw failed');
      },
    } as unknown as CanvasRenderingContext2D);
    expect(deck.drawDecodedCardImage(url, canvas)).toBe(false);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(canvas.dataset.cardArtworkReady).toBeUndefined();
  });
  it('shares a bounded load and cannot claim ready before every face decodes', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    const first = deck.prepareDeckImages('4color');
    expect(deck.prepareDeckImages('4color')).toBe(first);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(instances).toHaveLength(6);
    expect(deck.isDeckReady('4color')).toBe(false);
    const pendingSurface = document.createElement('canvas');
    expect(deck.drawDecodedCardImage(deck.deckImageUrls('4color')[0], pendingSurface)).toBe(false);
    expect(pendingSurface.dataset.cardArtworkReady).toBeUndefined();
    expect([pendingSurface.width, pendingSurface.height]).toEqual([0, 0]);
    await drain();
    await first;
    expect(instances).toHaveLength(52);
    expect(new Set(instances.map((image) => image.src)).size).toBe(52);
    expect(deck.isDeckReady('4color')).toBe(true);
    await deck.prepareDeckImages('4color');
    expect(instances).toHaveLength(52);
  });
  it('prepares a changed deck independently, including Data Saver connections', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    vi.stubGlobal('navigator', { connection: { saveData: true, effectiveType: '2g' } });
    const first = deck.prepareDeckImages('4color');
    await drain();
    await first;
    const second = deck.prepareDeckImages('2color');
    expect(deck.isDeckReady('2color')).toBe(false);
    await drain();
    await second;
    expect(instances).toHaveLength(104);
    expect(deck.isDeckReady('2color')).toBe(true);
  });
  it('retains the successfully decoded PNG so a reveal never repeats a missing WebP', async () => {
    rejectWebp = true;
    const deck = await import('../../src/utils/deckWarmer');
    const load = deck.prepareDeckImages('4color');
    await drain();
    await load;
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('.png'))
    ).toHaveLength(52);
    for (const url of deck.deckImageUrls('4color')) {
      expect(deck.decodedCardImageUrl(url)).toMatch(/^blob:card-/);
    }
  });
  it('does not cache failures as readiness and permits a subsequent entry to recover', async () => {
    rejectAll = true;
    const deck = await import('../../src/utils/deckWarmer');
    await expect(deck.prepareDeckImages('4color')).rejects.toThrow();
    expect(deck.isDeckReady('4color')).toBe(false);
    await drain();
    rejectAll = false;
    const next = deck.prepareDeckImages('4color');
    await drain();
    await next;
    expect(deck.isDeckReady('4color')).toBe(true);
  });
});
