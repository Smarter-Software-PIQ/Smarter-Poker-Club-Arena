/** Load and decode the selected deck before the table's existing art cover opens.
 * Keep decoded images alive: a requested URL is not evidence of paint readiness.
 * Each deck has one shared, bounded load; failed loads may be tried on next entry.
 */
import { MEDIA_BASE } from './mediaBase';
import { getDeckStyle } from '../hooks/useDeckStyle';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k', 'a'] as const;
type DeckStyle = '4color' | '2color';
const decoded = new Map<string, HTMLImageElement>();
const pending = new Map<DeckStyle, Promise<void>>();
const ready = new Set<DeckStyle>();
const listeners = new Set<() => void>();

export function subscribeCardImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function deckImageUrls(style: DeckStyle): string[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => `${MEDIA_BASE}cards/${style}/${suit}_${rank}.webp`)
  );
}

async function decodeImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('card_image_unavailable');
  const blob = await response.blob();
  if (!blob.size) throw new Error('empty_card_image');
  // Render from the retained bytes, not a second HTTP/SW request on every mount.
  // HTTP cache eviction or revalidation cannot replace a face mid-animation.
  const localUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error('card_image_timeout')), 8000);
      const fail = (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      };
      image.decoding = 'sync';
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          fail(new Error('empty_card_image'));
          return;
        }
        const decode = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
        void decode.then(() => {
          clearTimeout(timer);
          resolve(image);
        }, fail);
      };
      image.onerror = () => fail(new Error('card_image_unavailable'));
      image.src = localUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(localUrl);
    throw error;
  }
}

/** The renderer uses the exact decoded URL, including a successful PNG fallback. */
export function decodedCardImageUrl(url: string): string {
  return decoded.get(url)?.src ?? url;
}

/** Paint retained decoded pixels, rather than starting another image load on mount. */
export function drawDecodedCardImage(url: string, canvas: HTMLCanvasElement): boolean {
  delete canvas.dataset.cardArtworkReady;
  canvas.width = 0;
  canvas.height = 0;
  const image = decoded.get(url);
  if (!image || !image.naturalWidth || !image.naturalHeight) return false;
  try {
    // CSS shrinking a full-size canvas uses compositor sampling, unlike an img's
    // filtered reduction. Fine court-card lines then alias into distorted faces.
    // Reduce once at the displayed device resolution with high-quality filtering.
    // Hidden tables retain native pixels until ResizeObserver sees their real size.
    const box = canvas.parentElement ?? canvas;
    const scale =
      box.clientWidth && box.clientHeight
        ? Math.min(box.clientWidth / image.naturalWidth, box.clientHeight / image.naturalHeight)
        : 1;
    const density = window.devicePixelRatio || 1;
    const ratio = Math.min(1, scale * density);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('card_artwork_context_unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.dataset.cardArtworkReady = 'true';
    return true;
  } catch {
    // A failed draw must not retain an old card or claim artwork readiness.
    canvas.width = 0;
    canvas.height = 0;
    return false;
  }
}

export function isDeckReady(style: DeckStyle): boolean {
  return ready.has(style);
}

export function prepareDeckImages(style: DeckStyle): Promise<void> {
  if (ready.has(style)) return Promise.resolve();
  const existing = pending.get(style);
  if (existing) return existing;
  const urls = deckImageUrls(style);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (decoded.has(url)) continue;
      let image: HTMLImageElement;
      try {
        image = await decodeImage(url);
      } catch {
        image = await decodeImage(url.replace(/\.webp$/, '.png'));
      }
      decoded.set(url, image);
      listeners.forEach((listener) => listener());
    }
  };
  // Bound concurrent requests, but never stagger gameplay assets behind idle timers.
  const run = Promise.allSettled(Array.from({ length: 6 }, worker)).then((results) => {
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    ready.add(style);
  });
  pending.set(style, run);
  void run.finally(() => pending.delete(style)).catch(() => {});
  return run;
}

/** Optional lobby warming uses the same decoded cache as table entry. */
export function warmDeckImages(): void {
  void prepareDeckImages(getDeckStyle()).catch(() => {});
}
