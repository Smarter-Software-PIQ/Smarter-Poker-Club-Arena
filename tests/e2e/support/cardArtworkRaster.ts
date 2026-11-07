import type { Page } from '@playwright/test';
import sharp from 'sharp';

export type CardArtworkBounds = { x: number; y: number; width: number; height: number };
export type CardArtworkExposure = {
  id: string | number;
  firstEligibleAt: number;
  previousFrameAt?: number | null;
  bounds: CardArtworkBounds;
};
type Metadata = {
  timestamp?: number;
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
};
type Frame = { at: number; bytes: Buffer; metadata: Metadata };
export const CARD_ARTWORK_MAX_GAP_MS = 100;
const MAX_FRAMES = 64;
const MAX_BYTES = 12 * 1024 * 1024;
const finite = (n: number) => Number.isFinite(n);

/** Correlate the first-visible DOM interval with the earliest retained raster, not every physical frame. */
export function selectCardArtworkFrame<T extends { at: number }>(
  frames: readonly T[],
  at: number,
  previousFrameAt?: number | null
) {
  if (
    !finite(at) ||
    at <= 0 ||
    frames.some((f, i) => !finite(f.at) || f.at <= 0 || (i > 0 && f.at <= frames[i - 1].at))
  )
    return { reason: 'invalid-timestamp' } as const;
  const index = frames.findIndex((f) => f.at >= at);
  if (index < 0) return { reason: 'no-frame-after-exposure' } as const;
  if (index === 0) return { reason: 'missing-before-exposure-frame' } as const;
  const delayMs = frames[index].at - at;
  // CDP emits changed compositor frames: a static page may have no raster for
  // many seconds. Only a recent observed DOM frame can explain that idle gap.
  const recentDomInterval =
    typeof previousFrameAt === 'number' &&
    finite(previousFrameAt) &&
    previousFrameAt >= frames[index - 1].at &&
    previousFrameAt < at &&
    at - previousFrameAt <= CARD_ARTWORK_MAX_GAP_MS;
  if (
    delayMs > CARD_ARTWORK_MAX_GAP_MS ||
    (frames[index].at - frames[index - 1].at > CARD_ARTWORK_MAX_GAP_MS && !recentDomInterval)
  )
    return { reason: 'compositor-frame-gap' } as const;
  return { frame: frames[index], index, delayMs } as const;
}

/** Bounds are viewport CSS pixels; reject transforms we cannot prove and crop inward. */
export function cardArtworkCrop(
  bounds: CardArtworkBounds,
  width: number,
  height: number,
  meta: Metadata
) {
  const values = [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    width,
    height,
    meta.deviceWidth,
    meta.deviceHeight,
    meta.pageScaleFactor,
    meta.offsetTop,
    meta.scrollOffsetX,
    meta.scrollOffsetY,
  ];
  if (
    !values.every(finite) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096 ||
    meta.deviceWidth <= 0 ||
    meta.deviceHeight <= 0 ||
    meta.pageScaleFactor !== 1 ||
    meta.offsetTop !== 0 ||
    meta.scrollOffsetX !== 0 ||
    meta.scrollOffsetY !== 0 ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > meta.deviceWidth ||
    bounds.y + bounds.height > meta.deviceHeight
  )
    return null;
  const sx = width / meta.deviceWidth;
  const sy = height / meta.deviceHeight;
  if (sx <= 0 || sx > 4 || Math.abs(sx - sy) > 0.001) return null;
  const left = Math.ceil(bounds.x * sx);
  const top = Math.ceil(bounds.y * sy);
  const right = Math.floor((bounds.x + bounds.width) * sx);
  const bottom = Math.floor((bounds.y + bounds.height) * sy);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export type CardArtworkRasterCapture = {
  id: string | number;
  verdict: 'captured' | 'unknown';
  reason?: string;
  exposureAt: number;
  frameAt?: number;
  delayMs?: number;
  bounds?: CardArtworkBounds;
  frameMetadata?: Metadata & { width: number; height: number };
  image?: Buffer;
  coverage: 'correlated-first-visible-dom-interval-earliest-retained-raster-not-every-physical-frame';
};

/** Start before table navigation. Full viewport PNGs stay only in this bounded memory ring. */
export async function startCardArtworkRaster(page: Page) {
  const session = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const waiters = new Set<() => void>();
  let bytes = 0;
  let stopped = false;
  let capturing = false;
  let ackFailed = false;
  let oversizedFrame = false;
  // Event and command arguments infer the locked Playwright CDP protocol types.
  // protocol.d.ts: ScreencastFrameMetadata.timestamp is TimeSinceEpoch (seconds).
  session.on('Page.screencastFrame', (event) => {
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {
      ackFailed = true;
    });
    if (stopped) return;
    if (event.data.length > Math.ceil((MAX_BYTES * 4) / 3)) {
      oversizedFrame = true;
      return;
    }
    const frameBytes = Buffer.byteLength(event.data, 'base64');
    if (frameBytes > MAX_BYTES) {
      oversizedFrame = true;
      return;
    }
    // Evict before allocating the new PNG, preserving the byte bound even
    // while a capture pins the previous ring.
    while (frames.length >= MAX_FRAMES || bytes + frameBytes > MAX_BYTES)
      bytes -= frames.shift()!.bytes.length;
    const buffer = Buffer.from(event.data, 'base64');
    frames.push({
      at: (event.metadata.timestamp ?? Number.NaN) * 1000,
      bytes: buffer,
      metadata: {
        timestamp: event.metadata.timestamp,
        deviceWidth: event.metadata.deviceWidth,
        deviceHeight: event.metadata.deviceHeight,
        pageScaleFactor: event.metadata.pageScaleFactor,
        offsetTop: event.metadata.offsetTop,
        scrollOffsetX: event.metadata.scrollOffsetX,
        scrollOffsetY: event.metadata.scrollOffsetY,
      },
    });
    bytes += buffer.length;
    waiters.forEach((wake) => wake());
  });
  try {
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  } catch (error) {
    await session.detach();
    throw error;
  }
  return {
    async capture(exposures: readonly CardArtworkExposure[]): Promise<CardArtworkRasterCapture[]> {
      if (capturing)
        return exposures.map((exposure) => ({
          id: exposure.id,
          verdict: 'unknown' as const,
          reason: 'capture-already-active',
          exposureAt: exposure.firstEligibleAt,
          coverage:
            'correlated-first-visible-dom-interval-earliest-retained-raster-not-every-physical-frame' as const,
        }));
      capturing = true;
      try {
        // Pin before waiting: delivery can prune the preceding frame while the
        // consumer waits. One serial capture retains at most36MiB compressed:
        // entry pin12MiB + additional snapshot12MiB + future live ring12MiB.
        const pinned = frames.slice();
        const latest = Math.max(...exposures.map((e) => e.firstEligibleAt));
        if (
          !stopped &&
          finite(latest) &&
          (!frames.length || frames[frames.length - 1].at < latest)
        ) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              waiters.delete(wake);
              resolve();
            };
            const wake = () => {
              if (stopped || frames[frames.length - 1]?.at >= latest) finish();
            };
            const timer = setTimeout(finish, CARD_ARTWORK_MAX_GAP_MS + 20);
            waiters.add(wake);
          });
        }
        // Object identity removes overlap without hiding duplicate timestamps or
        // reordering invalid arrival sequences. All crops share this snapshot.
        const retained = [...new Set([...pinned, ...frames])];
        pinned.length = 0;
        const results: CardArtworkRasterCapture[] = [];
        for (const exposure of exposures) {
          const result: CardArtworkRasterCapture = {
            id: exposure.id,
            verdict: 'unknown',
            exposureAt: exposure.firstEligibleAt,
            coverage:
              'correlated-first-visible-dom-interval-earliest-retained-raster-not-every-physical-frame',
          };
          const selection = selectCardArtworkFrame(
            retained,
            exposure.firstEligibleAt,
            exposure.previousFrameAt
          );
          if (stopped || ackFailed || oversizedFrame || !selection.frame) {
            result.reason = stopped
              ? 'capture-stopped'
              : ackFailed
                ? 'frame-ack-failed'
                : oversizedFrame
                  ? 'frame-byte-bound-exceeded'
                  : selection.reason;
          } else {
            const frame = selection.frame;
            try {
              const image = sharp(frame.bytes, { limitInputPixels: 4096 * 4096 });
              const dimensions = await image.metadata();
              const width = dimensions.width ?? 0;
              const height = dimensions.height ?? 0;
              const crop = cardArtworkCrop(exposure.bounds, width, height, frame.metadata);
              if (!crop) result.reason = 'unproven-scaling-or-public-bounds';
              else {
                result.image = await image.extract(crop).png().toBuffer();
                result.verdict = 'captured';
                result.frameAt = frame.at;
                result.delayMs = selection.delayMs;
                result.bounds = {
                  x: exposure.bounds.x,
                  y: exposure.bounds.y,
                  width: exposure.bounds.width,
                  height: exposure.bounds.height,
                };
                result.frameMetadata = { ...frame.metadata, width, height };
              }
            } catch {
              result.reason = 'raster-decode-or-crop-failed';
            }
          }
          results.push(result);
        }
        return results;
      } finally {
        capturing = false;
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      frames.length = 0;
      bytes = 0;
      waiters.forEach((wake) => wake());
      try {
        await session.send('Page.stopScreencast');
      } finally {
        await session.detach();
      }
    },
  };
}
