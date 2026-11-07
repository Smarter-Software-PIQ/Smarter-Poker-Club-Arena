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
  it('shares a bounded load and cannot claim ready before every face decodes', async () => {
    const deck = await import('../../src/utils/deckWarmer');
    const first = deck.prepareDeckImages('4color');
    expect(deck.prepareDeckImages('4color')).toBe(first);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(instances).toHaveLength(6);
    expect(deck.isDeckReady('4color')).toBe(false);
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
