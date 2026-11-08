import type { EngineFrame } from './liveTableRealtime';

/** Bounded observation only. No card values, URLs, transport payloads or private hero images leave the page. */
export type CardArtworkExposure = {
  id: number;
  kind: 'board' | 'public-hole';
  hand: number;
  slot: number;
  sourceEpoch: number;
  visibilityEpoch: number;
  natural: boolean;
  firstEligibleAt: number;
  performanceAt: number;
  previousFrameAt: number | null;
  gapMs: number | null;
  surfaceKind?: 'image' | 'decoded-canvas';
  imageVisible: boolean;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  local: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  /** Public outer card slot, separate from the rotating face's subpixel bounds. */
  rasterBounds?: { x: number; y: number; width: number; height: number };
};
export type CardArtworkSnapshot = {
  schema: 'card-artwork-first-visible-raf/v1';
  installedAt: number;
  tableSeenAt: number | null;
  installedBeforeTable: boolean;
  stopped: boolean;
  stopReason: 'manual' | 'deadline' | 'exposure-cap' | null;
  maxFrameGapMs: number;
  ticks: number;
  eligibleTableFrames: number;
  interruptions: number;
  overflow: boolean;
  exposures: CardArtworkExposure[];
  measurements: {
    cardResourceRequests: number;
    completedCardResources: number;
    fetchRequests: number;
    imageRequests: number;
    pngRequests: number;
    transferBytes: number;
    encodedBodyBytes: number;
    resourceDurationMs: number;
    maxResourceDurationMs: number;
    visibleDecodedSurfaceBytesEstimate: number;
    memoryLimit: 'Visible unique image surfaces only; not total cache bytes or resident native image memory';
  };
};
export type CardArtworkObserver = {
  snapshot: () => CardArtworkSnapshot;
  stop: () => CardArtworkSnapshot;
};
declare global {
  interface Window {
    __cardArtworkFrames?: CardArtworkObserver;
  }
}

/** Must be serialized into the spectator page before entering the selected table. */
export function installCardArtworkFrames(options: {
  deadline: number;
  tableId: string;
  maxFrameGapMs: number;
  maxExposures?: number;
}): void {
  window.__cardArtworkFrames?.stop();
  const installedAt = Date.now();
  const exposures: CardArtworkExposure[] = [];
  const state: Omit<CardArtworkSnapshot, 'exposures' | 'measurements'> = {
    schema: 'card-artwork-first-visible-raf/v1',
    installedAt,
    tableSeenAt: null,
    installedBeforeTable: !location.pathname.endsWith(`/table/${options.tableId}`),
    stopped: false,
    stopReason: null,
    maxFrameGapMs: options.maxFrameGapMs,
    ticks: 0,
    eligibleTableFrames: 0,
    interruptions: 0,
    overflow: false,
  };
  const seen = new WeakMap<
    HTMLElement,
    {
      id: number;
      source: string;
      sourceEpoch: number;
      visibilityEpoch: number;
      eligible: boolean;
      everEligible: boolean;
      initialAtJoin: boolean;
      natural: boolean;
    }
  >();
  let nextId = 1,
    raf = 0,
    previousFrameAt: number | null = null;
  let visibleBytesEstimate = 0;
  const maxExposures = Math.min(128, Math.max(1, options.maxExposures ?? 48));
  const visible = (node: Element): boolean => {
    let matrix: DOMMatrixReadOnly | null = null;
    let hidesBackface = false;
    for (let current: Element | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0)
        return false;
      hidesBackface ||= style.backfaceVisibility === 'hidden';
      if (style.transform && style.transform !== 'none') {
        try {
          const transform = new DOMMatrixReadOnly(style.transform);
          matrix = matrix ? transform.multiply(matrix) : transform;
        } catch {
          return false;
        }
      }
    }
    if (hidesBackface && matrix && matrix.m33 <= 0) return false;
    const bounds = node.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.right > 0 &&
      bounds.bottom > 0 &&
      bounds.left < innerWidth &&
      bounds.top < innerHeight
    );
  };
  const snapshot = (): CardArtworkSnapshot => {
    const resources = performance.getEntriesByType('resource').filter((entry) => {
      try {
        return /\/cards\/(?:2color|4color)\/[^/]+\.(?:webp|png)$/.test(
          new URL(entry.name).pathname
        );
      } catch {
        return false;
      }
    }) as PerformanceResourceTiming[];
    return {
      ...state,
      exposures: exposures.map((entry) => ({ ...entry, bounds: { ...entry.bounds } })),
      measurements: {
        cardResourceRequests: resources.length,
        completedCardResources: resources.filter((entry) => entry.responseEnd > 0).length,
        fetchRequests: resources.filter((entry) => entry.initiatorType === 'fetch').length,
        imageRequests: resources.filter((entry) => entry.initiatorType === 'img').length,
        pngRequests: resources.filter((entry) => {
          try {
            return new URL(entry.name).pathname.endsWith('.png');
          } catch {
            return false;
          }
        }).length,
        transferBytes: resources.reduce(
          (sum, entry) => sum + Math.max(0, entry.transferSize || 0),
          0
        ),
        encodedBodyBytes: resources.reduce(
          (sum, entry) => sum + Math.max(0, entry.encodedBodySize || 0),
          0
        ),
        resourceDurationMs: resources.reduce(
          (sum, entry) => sum + Math.max(0, entry.duration || 0),
          0
        ),
        maxResourceDurationMs: Math.max(
          0,
          ...resources.map((entry) => Math.max(0, entry.duration || 0))
        ),
        visibleDecodedSurfaceBytesEstimate: visibleBytesEstimate,
        memoryLimit:
          'Visible unique image surfaces only; not total cache bytes or resident native image memory',
      },
    };
  };
  const stop = (reason: NonNullable<CardArtworkSnapshot['stopReason']> = 'manual') => {
    state.stopped = true;
    state.stopReason ??= reason;
    cancelAnimationFrame(raf);
    return snapshot();
  };
  window.__cardArtworkFrames = { snapshot, stop: () => stop() };
  const tick = () => {
    if (state.stopped) return;
    if (Date.now() >= options.deadline) {
      stop('deadline');
      return;
    }
    const now = Date.now();
    const gapMs = previousFrameAt === null ? null : now - previousFrameAt;
    const prior = previousFrameAt;
    previousFrameAt = now;
    state.ticks++;
    const roots = [...document.querySelectorAll<HTMLElement>('.table-page')].filter(visible);
    const root = roots.length === 1 ? roots[0] : null;
    const routeMatches = location.pathname.endsWith(`/table/${options.tableId}`);
    const contextValid = document.visibilityState === 'visible' && document.hasFocus();
    if (root && routeMatches) state.tableSeenAt ??= now;
    const blocked =
      !!root &&
      [
        ...document.querySelectorAll('[role="dialog"], [data-testid="table-connection-banner"]'),
      ].some(visible);
    if (root && routeMatches && (!contextValid || blocked)) state.interruptions++;
    const cover = root?.querySelector('.table-art-cover');
    if (
      !root ||
      !routeMatches ||
      !contextValid ||
      blocked ||
      root.classList.contains('table-page--backgrounded') ||
      (cover && visible(cover))
    ) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const labels = [...root.querySelectorAll('.header-hand-number, .table-brand__hand')];
    const hands = labels.map((label) =>
      Number(/^\s*(?:Hand\s+)?#\s*(\d+)\s*$/.exec(label.textContent ?? '')?.[1])
    );
    const hand = hands[0];
    if (
      !hands.length ||
      !Number.isSafeInteger(hand) ||
      hand <= 0 ||
      hands.some((value) => value !== hand)
    ) {
      raf = requestAnimationFrame(tick);
      return;
    }
    state.eligibleTableFrames++;
    const surfaces = [
      ...root.querySelectorAll<HTMLElement>(
        '.community-cards__card .card-image:not(.card-image--back), .seat:not(.seat--hero) .seat__card--face .card-image:not(.card-image--back)'
      ),
    ];
    const uniqueVisibleSources = new Set<string>();
    let frameSurfaceBytes = 0;
    surfaces.forEach((surface) => {
      const image = surface.querySelector<HTMLImageElement>('.card-image__img');
      const source = image?.currentSrc || image?.src || '';
      const canvas = surface.querySelector<HTMLCanvasElement>('.card-image__artwork');
      const paintedCanvas =
        !!canvas &&
        canvas.dataset.cardArtworkReady === 'true' &&
        canvas.width > 0 &&
        canvas.height > 0 &&
        visible(canvas);
      const artworkVisible = paintedCanvas || (!!image && visible(image));
      const artworkComplete = paintedCanvas || (image?.complete ?? false);
      const artworkWidth = paintedCanvas ? canvas!.width : (image?.naturalWidth ?? 0);
      const artworkHeight = paintedCanvas ? canvas!.height : (image?.naturalHeight ?? 0);
      let item = seen.get(surface);
      if (!item) {
        item = {
          id: nextId++,
          source,
          sourceEpoch: 1,
          visibilityEpoch: 0,
          eligible: false,
          everEligible: false,
          natural: false,
          initialAtJoin: state.eligibleTableFrames <= 2,
        };
        seen.set(surface, item);
      }
      const sourceChanged = item.source !== source;
      if (sourceChanged) {
        item.source = source;
        item.sourceEpoch++;
      }
      const eligible = visible(surface);
      const imageVisible = artworkVisible;
      if (
        eligible &&
        imageVisible &&
        artworkComplete &&
        artworkWidth > 0 &&
        !uniqueVisibleSources.has(source)
      ) {
        uniqueVisibleSources.add(source);
        frameSurfaceBytes += artworkWidth * artworkHeight * 4;
      }
      if (eligible && (!item.eligible || sourceChanged)) {
        if (!item.eligible) {
          item.visibilityEpoch++;
          item.natural = !item.initialAtJoin || item.everEligible;
        }
        const bounds = surface.getBoundingClientRect();
        const slot = surface.closest('.community-cards__card, .seat__card')!;
        const rasterBounds = slot.getBoundingClientRect();
        if (exposures.length >= maxExposures) {
          state.overflow = true;
          return;
        }
        exposures.push({
          id: item.id,
          kind: surface.closest('.community-cards__card') ? 'board' : 'public-hole',
          hand,
          // Stable physical positions, not the combined selector's DOM order.
          slot: surface.closest('.community-cards__card')
            ? [...surface.closest('.community-cards__card')!.parentElement!.children].indexOf(
                surface.closest('.community-cards__card')!
              )
            : [...root.querySelectorAll('.seat')].indexOf(surface.closest('.seat')!) * 8 +
              [...surface.closest('.seat')!.querySelectorAll('.seat__card')].indexOf(
                surface.closest('.seat__card')!
              ),
          sourceEpoch: item.sourceEpoch,
          visibilityEpoch: item.visibilityEpoch,
          natural: item.natural,
          firstEligibleAt: now,
          performanceAt: performance.now(),
          previousFrameAt: prior,
          gapMs,
          surfaceKind: paintedCanvas ? 'decoded-canvas' : 'image',
          imageVisible,
          complete: artworkComplete,
          naturalWidth: artworkWidth,
          naturalHeight: artworkHeight,
          local: source.startsWith('blob:'),
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          rasterBounds: {
            x: rasterBounds.x,
            y: rasterBounds.y,
            width: rasterBounds.width,
            height: rasterBounds.height,
          },
        });
        item.everEligible = true;
      }
      item.eligible = eligible;
    });
    visibleBytesEstimate = Math.max(visibleBytesEstimate, frameSurfaceBytes);
    if (state.overflow) {
      stop('exposure-cap');
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** First eligible rAF readiness is distinct from actual compositor frame coverage. */
export function cardArtworkFramesEvidence(
  snapshot: CardArtworkSnapshot,
  required = {
    board: true,
    publicHoles: true,
  }
) {
  const entries = Array.isArray(snapshot.exposures) ? snapshot.exposures : [];
  const malformed =
    snapshot.schema !== 'card-artwork-first-visible-raf/v1' ||
    !Array.isArray(snapshot.exposures) ||
    !Number.isFinite(snapshot.installedAt) ||
    (snapshot.tableSeenAt !== null &&
      (!Number.isFinite(snapshot.tableSeenAt) || snapshot.tableSeenAt < snapshot.installedAt)) ||
    !Number.isFinite(snapshot.maxFrameGapMs) ||
    snapshot.maxFrameGapMs <= 0 ||
    entries.some(
      (entry) =>
        !Number.isSafeInteger(entry.hand) ||
        entry.hand <= 0 ||
        !Number.isSafeInteger(entry.id) ||
        entry.id <= 0 ||
        !Number.isSafeInteger(entry.slot) ||
        entry.slot < 0 ||
        !Number.isSafeInteger(entry.sourceEpoch) ||
        entry.sourceEpoch <= 0 ||
        !Number.isSafeInteger(entry.visibilityEpoch) ||
        entry.visibilityEpoch <= 0 ||
        typeof entry.natural !== 'boolean' ||
        typeof entry.imageVisible !== 'boolean' ||
        (entry.surfaceKind !== undefined &&
          !['image', 'decoded-canvas'].includes(entry.surfaceKind)) ||
        (entry.rasterBounds !== undefined &&
          (!entry.rasterBounds ||
            Object.values(entry.rasterBounds).some((value) => !Number.isFinite(value)) ||
            entry.rasterBounds.width <= 0 ||
            entry.rasterBounds.height <= 0)) ||
        typeof entry.complete !== 'boolean' ||
        typeof entry.local !== 'boolean' ||
        !Number.isFinite(entry.firstEligibleAt) ||
        entry.firstEligibleAt < snapshot.installedAt ||
        !Number.isFinite(entry.performanceAt) ||
        entry.performanceAt < 0 ||
        (entry.previousFrameAt !== null && !Number.isFinite(entry.previousFrameAt)) ||
        (entry.gapMs !== null && (!Number.isFinite(entry.gapMs) || entry.gapMs < 0)) ||
        (entry.previousFrameAt !== null &&
          entry.gapMs !== entry.firstEligibleAt - entry.previousFrameAt) ||
        !Number.isFinite(entry.naturalWidth) ||
        !Number.isFinite(entry.naturalHeight) ||
        !['board', 'public-hole'].includes(entry.kind) ||
        !entry.bounds ||
        Object.values(entry.bounds).some((value) => !Number.isFinite(value)) ||
        entry.bounds.width <= 0 ||
        entry.bounds.height <= 0
    );
  const natural = entries.filter((entry) => entry.natural);
  const notReady = entries.filter(
    (entry) =>
      !entry.imageVisible ||
      !entry.complete ||
      entry.naturalWidth <= 0 ||
      entry.naturalHeight <= 0 ||
      !entry.local
  );
  const late = entries.filter(
    (entry) =>
      entry.previousFrameAt === null ||
      entry.gapMs === null ||
      entry.gapMs < 0 ||
      entry.gapMs > snapshot.maxFrameGapMs
  );
  const board = natural.filter((entry) => entry.kind === 'board');
  const publicHoles = natural.filter((entry) => entry.kind === 'public-hole');
  const missing =
    (required.board && board.length === 0) || (required.publicHoles && publicHoles.length === 0);
  return {
    kind: 'card-artwork-first-visible-raf-evidence/v1',
    verdict:
      malformed || notReady.length
        ? 'violation'
        : !snapshot.installedBeforeTable ||
            snapshot.tableSeenAt === null ||
            snapshot.interruptions > 0 ||
            snapshot.overflow ||
            late.length ||
            missing
          ? 'unknown'
          : 'qualified',
    limit:
      'First eligible requestAnimationFrame rendered artwork readiness (loaded image or synchronously drawn decoded canvas); compositor raster coverage must be correlated separately. Public showdown holes only; no private hero participation.',
    counts: {
      board: board.length,
      publicHoles: publicHoles.length,
      notReady: notReady.length,
      late: late.length,
    },
    malformed,
    missing,
    snapshot,
  } as const;
}

/** Match fresh physical card positions to one natural wire hand, never join different hands or remounts. */
export function cardArtworkSameHandEvidence(
  snapshot: CardArtworkSnapshot,
  receipts: Array<{ hand: number; to: number; verdict: string }>,
  frames: EngineFrame[],
  tableId: string
): {
  verdict: 'qualified' | 'unknown';
  hand: number | null;
  boardIds: number[];
  publicHoleIds: number[];
} {
  const unknown = { verdict: 'unknown' as const, hand: null, boardIds: [], publicHoleIds: [] };
  const candidateHands = [
    ...new Set(
      receipts.filter((receipt) => receipt.verdict === 'qualified').map((receipt) => receipt.hand)
    ),
  ]
    .filter((hand) => Number.isSafeInteger(hand) && hand > 0)
    .sort((a, b) => a - b);
  for (const hand of candidateHands) {
    if (
      ![4, 5].every(
        (to) =>
          receipts.filter(
            (receipt) =>
              receipt.hand === hand && receipt.to === to && receipt.verdict === 'qualified'
          ).length === 1
      )
    )
      continue;
    const wire = frames.filter((frame) => {
      const payload = frame.message.payload as Record<string, unknown> | undefined;
      return (
        frame.direction === 'received' &&
        frame.message.type === 'EVENT' &&
        frame.message.tableId === tableId &&
        frame.message.replayed !== true &&
        payload?.replayed !== true &&
        payload?.type === 'community_cards_dealt' &&
        payload.table_id === tableId &&
        Number(payload.hand_number) === hand
      );
    });
    if (
      wire.length !== 3 ||
      wire.some((frame) => {
        const payload = frame.message.payload as Record<string, unknown>;
        return (
          !Array.isArray(payload.board) ||
          ![3, 4, 5].includes(payload.board.length) ||
          !Array.isArray(payload.board2) ||
          payload.board2.length !== 0 ||
          !Array.isArray(payload.board3) ||
          payload.board3.length !== 0 ||
          !Number.isFinite(frame.at)
        );
      })
    )
      continue;
    const events = [3, 4, 5].map((count) =>
      wire.filter(
        (frame) => (frame.message.payload as Record<string, unknown[]>).board.length === count
      )
    );
    if (events.some((event) => event.length !== 1)) continue;
    const times = events.map((event) => event[0].at);
    if (!(times[0] < times[1] && times[1] < times[2])) continue;
    // First exposure for each physical position also includes initial-at-join entries.
    // A later remount cannot turn an initial or missed face into fresh coverage.
    const firstByPosition = new Map<string, CardArtworkExposure>();
    for (const entry of snapshot.exposures
      .filter((entry) => entry.hand === hand)
      .sort((a, b) => a.firstEligibleAt - b.firstEligibleAt)) {
      const key = `${entry.kind}:${entry.slot}`;
      if (!firstByPosition.has(key)) firstByPosition.set(key, entry);
    }
    const board: CardArtworkExposure[] = [];
    for (let slot = 0; slot < 5; slot++) {
      const entry = firstByPosition.get(`board:${slot}`);
      const street = slot < 3 ? 0 : slot - 2;
      if (
        !entry?.natural ||
        entry.firstEligibleAt < times[street] ||
        entry.firstEligibleAt - times[street] > 1000 ||
        (street < 2 && entry.firstEligibleAt >= times[street + 1])
      )
        continue;
      board.push(entry);
    }
    if (board.length !== 5 || new Set(board.map((entry) => entry.id)).size !== 5) continue;
    const holeEntries = [...firstByPosition.values()].filter(
      (entry) => entry.kind === 'public-hole' && entry.natural
    );
    const holes: CardArtworkExposure[] = [];
    for (const entry of holeEntries) {
      if (!holes.some((existing) => existing.id === entry.id || existing.slot === entry.slot))
        holes.push(entry);
    }
    if (holes.length < 2) continue;
    return {
      verdict: 'qualified',
      hand,
      boardIds: board.map((entry) => entry.id),
      publicHoleIds: holes.map((entry) => entry.id),
    };
  }
  return unknown;
}
