import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardArtworkFramesEvidence,
  cardArtworkSameHandEvidence,
  installCardArtworkFrames,
  type CardArtworkExposure,
  type CardArtworkSnapshot,
} from '../e2e/support/cardArtworkFrames';

const exposure = (
  kind: CardArtworkExposure['kind'],
  patch: Partial<CardArtworkExposure> = {}
): CardArtworkExposure => ({
  id: kind === 'board' ? 1 : 2,
  kind,
  hand: 42,
  slot: 0,
  sourceEpoch: 1,
  visibilityEpoch: 1,
  natural: true,
  firstEligibleAt: 116,
  performanceAt: 16,
  previousFrameAt: 100,
  gapMs: 16,
  imageVisible: true,
  complete: true,
  naturalWidth: 360,
  naturalHeight: 504,
  local: true,
  bounds: { x: 10, y: 10, width: 50, height: 70 },
  ...patch,
});
const snapshot = (): CardArtworkSnapshot => ({
  schema: 'card-artwork-first-visible-raf/v1',
  installedAt: 0,
  tableSeenAt: 10,
  installedBeforeTable: true,
  stopped: true,
  stopReason: 'manual',
  maxFrameGapMs: 100,
  ticks: 3,
  eligibleTableFrames: 3,
  interruptions: 0,
  overflow: false,
  exposures: [exposure('board'), exposure('public-hole')],
  measurements: {
    cardResourceRequests: 52,
    completedCardResources: 52,
    fetchRequests: 52,
    imageRequests: 0,
    pngRequests: 0,
    transferBytes: 1000,
    encodedBodyBytes: 900,
    resourceDurationMs: 200,
    maxResourceDurationMs: 20,
    visibleDecodedSurfaceBytesEstimate: 360 * 504 * 4 * 2,
    memoryLimit:
      'Visible unique image surfaces only; not total cache bytes or resident native image memory',
  },
});
describe('first eligible artwork frame qualification', () => {
  it('requires ready natural board and public hole exposures, separate from physical raster coverage', () => {
    const result = cardArtworkFramesEvidence(snapshot());
    expect(result.verdict).toBe('qualified');
    expect(result.limit).toContain('compositor raster coverage must be correlated separately');
    expect(result.limit).toContain('no private hero participation');
  });
  it.each([
    { imageVisible: false },
    { complete: false },
    { naturalWidth: 0 },
    { naturalHeight: 0 },
    { local: false },
  ])('rejects first-visible incomplete or HTTP artwork %j', (patch) => {
    const input = snapshot();
    input.exposures[0] = exposure('board', patch);
    expect(cardArtworkFramesEvidence(input).verdict).toBe('violation');
  });
  it('does not excuse a broken initial visible face after later natural faces load', () => {
    const input = snapshot();
    input.exposures.unshift(exposure('board', { id: 3, natural: false, complete: false }));
    expect(cardArtworkFramesEvidence(input).verdict).toBe('violation');
  });
  it.each(['board', 'public-hole'] as const)(
    'does not qualify initial-at-join %s faces as natural',
    (kind) => {
      const input = snapshot();
      input.exposures = input.exposures.map((row) =>
        row.kind === kind ? { ...row, natural: false } : row
      );
      expect(cardArtworkFramesEvidence(input).verdict).toBe('unknown');
    }
  );
  it.each([
    { gapMs: 116, previousFrameAt: 0 },
    { gapMs: null, previousFrameAt: null },
  ])('refuses missed/late first-frame coverage %j', (patch) => {
    const input = snapshot();
    input.exposures[0] = exposure('board', patch);
    expect(cardArtworkFramesEvidence(input).verdict).toBe('unknown');
  });
  it.each([
    { naturalWidth: NaN },
    { surfaceKind: 'pending' as unknown as CardArtworkExposure['surfaceKind'] },
    { rasterBounds: { x: 0, y: 0, width: 0, height: 70 } },
    { local: 'yes' as unknown as boolean },
    { sourceEpoch: 0 },
    { gapMs: NaN },
    { performanceAt: -1 },
    { bounds: { x: 0, y: 0, width: 0, height: 70 } },
  ])('rejects malformed readiness metadata %j', (patch) => {
    const input = snapshot();
    input.exposures[0] = exposure('board', patch);
    expect(cardArtworkFramesEvidence(input).verdict).toBe('violation');
  });
  it.each([
    { interruptions: 1 },
    { overflow: true },
    { installedBeforeTable: false },
    { tableSeenAt: null },
  ])('keeps incomplete observer custody unknown %j', (patch) => {
    expect(cardArtworkFramesEvidence({ ...snapshot(), ...patch }).verdict).toBe('unknown');
  });
});

let callback: FrameRequestCallback | undefined;
let now = 0;
const frame = () => {
  now += 16;
  const tick = callback;
  callback = undefined;
  tick?.(now);
};
const image = (classes: string, source = 'blob:PRIVATE_URL_DO_NOT_EXPORT') => {
  const node = document.createElement('img');
  node.className = 'card-image__img';
  node.src = source;
  Object.defineProperties(node, {
    complete: { value: true, configurable: true },
    naturalWidth: { value: 360, configurable: true },
    naturalHeight: { value: 504, configurable: true },
  });
  node.alt = 'PRIVATE_RANK_DO_NOT_EXPORT';
  const wrapper = document.createElement('div');
  wrapper.className = classes;
  const surface = document.createElement('div');
  surface.className = 'card-image';
  surface.append(node);
  wrapper.append(surface);
  return { node, wrapper };
};
beforeEach(() => {
  now = 0;
  callback = undefined;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
    callback = next;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    callback = undefined;
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const hidden = (this as HTMLElement).dataset.hidden === 'true';
    return {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: hidden ? 10 : 60,
      bottom: hidden ? 10 : 80,
      width: hidden ? 0 : 50,
      height: hidden ? 0 : 70,
      toJSON: () => ({}),
    };
  });
  vi.stubGlobal('getComputedStyle', (node: HTMLElement) => ({
    display: node.dataset.hidden === 'true' ? 'none' : 'block',
    visibility: 'visible',
    opacity: '1',
    transform: node.dataset.transform || 'none',
    backfaceVisibility: node.dataset.backface === 'hidden' ? 'hidden' : 'visible',
  }));
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  history.replaceState({}, '', '/before-table');
});
afterEach(() => {
  window.__cardArtworkFrames?.stop();
  delete window.__cardArtworkFrames;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('samples actual newly exposed image epochs but never exports card data or initial-at-join coverage', () => {
  installCardArtworkFrames({ deadline: 1000, tableId: 'table', maxFrameGapMs: 100 });
  history.replaceState({}, '', '/table/table');
  document.body.innerHTML =
    '<div class="table-page"><div class="table-brand__hand">Hand #42</div><div class="community-cards__card"></div><div class="seat"></div></div>';
  const board = image('community-cards__card');
  document.querySelector('.table-page')!.append(board.wrapper);
  frame();
  frame();
  expect(window.__cardArtworkFrames!.snapshot().exposures[0].natural).toBe(false);
  const holes = image('seat__card seat__card--face');
  document.querySelector('.seat')!.append(holes.wrapper);
  frame();
  const first = window.__cardArtworkFrames!.snapshot();
  expect(first.exposures.at(-1)).toMatchObject({
    kind: 'public-hole',
    natural: true,
    complete: true,
    local: true,
  });
  holes.node.src = 'blob:SECOND_PRIVATE_URL';
  frame();
  expect(window.__cardArtworkFrames!.snapshot().exposures.at(-1)).toMatchObject({
    sourceEpoch: 2,
    natural: true,
  });
  holes.wrapper.dataset.hidden = 'true';
  frame();
  holes.wrapper.dataset.hidden = 'false';
  frame();
  expect(window.__cardArtworkFrames!.snapshot().exposures.at(-1)).toMatchObject({
    visibilityEpoch: 2,
  });
  const exported = JSON.stringify(window.__cardArtworkFrames!.stop());
  expect(exported).not.toContain('PRIVATE_URL');
  expect(exported).not.toContain('PRIVATE_RANK');
});

it('records a visible fallback as unready when its actual image is hidden', () => {
  installCardArtworkFrames({ deadline: 1000, tableId: 'table', maxFrameGapMs: 100 });
  history.replaceState({}, '', '/table/table');
  document.body.innerHTML =
    '<div class="table-page"><div class="table-brand__hand">Hand #42</div><div class="seat"></div></div>';
  frame();
  frame();
  const holes = image('seat__card seat__card--face');
  holes.node.dataset.hidden = 'true';
  document.querySelector('.seat')!.append(holes.wrapper);
  frame();
  const result = window.__cardArtworkFrames!.snapshot();
  expect(result.exposures).toHaveLength(1);
  expect(result.exposures[0]).toMatchObject({ natural: true, imageVisible: false });
  expect(cardArtworkFramesEvidence(result).verdict).toBe('violation');
});

it.each([true, false])(
  'samples the actually painted decoded canvas when the replacement image is pending: %s',
  (painted) => {
    installCardArtworkFrames({ deadline: 1000, tableId: 'table', maxFrameGapMs: 100 });
    history.replaceState({}, '', '/table/table');
    document.body.innerHTML =
      '<div class="table-page"><div class="table-brand__hand">Hand #42</div><div class="seat"></div></div>';
    frame();
    frame();
    const holes = image('seat__card seat__card--face');
    Object.defineProperties(holes.node, {
      complete: { value: false },
      naturalWidth: { value: 0 },
      naturalHeight: { value: 0 },
    });
    const canvas = document.createElement('canvas');
    canvas.className = 'card-image__artwork';
    canvas.width = 360;
    canvas.height = 504;
    canvas.dataset.cardArtworkReady = String(painted);
    holes.wrapper.querySelector('.card-image')!.append(canvas);
    document.querySelector('.seat')!.append(holes.wrapper);
    frame();
    const entry = window.__cardArtworkFrames!.snapshot().exposures[0];
    expect(entry).toMatchObject({
      surfaceKind: painted ? 'decoded-canvas' : 'image',
      complete: painted,
      naturalWidth: painted ? 360 : 0,
    });
    expect(
      cardArtworkFramesEvidence(window.__cardArtworkFrames!.snapshot(), {
        board: false,
        publicHoles: true,
      }).verdict
    ).toBe(painted ? 'qualified' : 'violation');
    expect(entry.rasterBounds).toEqual({ x: 10, y: 10, width: 50, height: 70 });
  }
);

it('waits for the composed 3D front face, then samples the very first visible opportunity', () => {
  class Matrix {
    m33: number;
    constructor(value: string) {
      this.m33 = Number(value);
    }
    multiply(other: Matrix) {
      return new Matrix(String(this.m33 * other.m33));
    }
  }
  vi.stubGlobal('DOMMatrixReadOnly', Matrix);
  installCardArtworkFrames({ deadline: 1000, tableId: 'table', maxFrameGapMs: 100 });
  history.replaceState({}, '', '/table/table');
  document.body.innerHTML =
    '<div class="table-page"><div class="table-brand__hand">Hand #42</div></div>';
  frame();
  frame();
  const card = image('community-cards__card');
  const front = document.createElement('div');
  front.dataset.transform = '-1';
  front.dataset.backface = 'hidden';
  front.append(card.wrapper);
  document.querySelector('.table-page')!.append(front);
  frame();
  expect(window.__cardArtworkFrames!.snapshot().exposures).toHaveLength(0);
  front.dataset.transform = '1';
  Object.defineProperty(card.node, 'complete', { value: false });
  frame();
  const capture = window.__cardArtworkFrames!.snapshot();
  expect(capture.exposures).toHaveLength(1);
  expect(capture.exposures[0]).toMatchObject({
    natural: true,
    firstEligibleAt: now,
    complete: false,
  });
  expect(cardArtworkFramesEvidence(capture).verdict).toBe('violation');
});

const naturalWire = (count: number, at: number, hand = 42) => ({
  at,
  direction: 'received' as const,
  socketId: 1,
  message: {
    type: 'EVENT',
    tableId: 'table',
    payload: {
      type: 'community_cards_dealt',
      table_id: 'table',
      hand_number: hand,
      board: Array(count).fill('PUBLIC_VALUE_NOT_EXPORTED'),
      board2: [] as string[],
      board3: [] as string[],
    },
  },
});
const sameHandFixture = () => {
  const input = snapshot();
  input.exposures = Array.from({ length: 5 }, (_, slot) =>
    exposure('board', {
      id: slot + 1,
      slot,
      firstEligibleAt: (slot < 3 ? 1000 : slot === 3 ? 3000 : 5000) + 100,
    })
  ).concat([
    exposure('public-hole', { id: 6, slot: 8, firstEligibleAt: 5500 }),
    exposure('public-hole', { id: 7, slot: 9, firstEligibleAt: 5500 }),
  ]);
  return {
    input,
    receipts: [
      { hand: 42, to: 4, verdict: 'qualified' },
      { hand: 42, to: 5, verdict: 'qualified' },
    ],
    wire: [naturalWire(3, 1000), naturalWire(4, 3000), naturalWire(5, 5000)],
  };
};
describe('same natural hand artwork correlation', () => {
  it('requires fresh flop, turn, river and two distinct public physical hole slots', () => {
    const { input, receipts, wire } = sameHandFixture();
    const result = cardArtworkSameHandEvidence(input, receipts, wire, 'table');
    expect(result).toEqual({
      verdict: 'qualified',
      hand: 42,
      boardIds: [1, 2, 3, 4, 5],
      publicHoleIds: [6, 7],
    });
    expect(JSON.stringify(result)).not.toContain('PUBLIC_VALUE');
  });
  it('does not count source epochs or remount ids as a second physical hole', () => {
    const { input, receipts, wire } = sameHandFixture();
    input.exposures.at(-1)!.slot = 8;
    input.exposures.push({ ...input.exposures.at(-1)!, id: 8, sourceEpoch: 2 });
    expect(cardArtworkSameHandEvidence(input, receipts, wire, 'table').verdict).toBe('unknown');
  });
  it('allows later board animation remounts without replacing the original first-visible samples', () => {
    const { input, receipts, wire } = sameHandFixture();
    input.exposures.push(exposure('board', { id: 8, slot: 0, firstEligibleAt: 3200 }));
    expect(cardArtworkSameHandEvidence(input, receipts, wire, 'table').boardIds).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
  it('does not repair a missed initial flop by counting a later remount', () => {
    const { input, receipts, wire } = sameHandFixture();
    input.exposures[0].natural = false;
    input.exposures.push(exposure('board', { id: 8, slot: 0, firstEligibleAt: 1300 }));
    expect(cardArtworkSameHandEvidence(input, receipts, wire, 'table').verdict).toBe('unknown');
  });
  it.each([
    'missing-flop',
    'duplicate-turn',
    'replayed-flop',
    'multiple-board',
    'foreign-table',
    'late-face',
    'other-hand-hole',
    'other-hand-river',
    'same-id-board',
  ])('refuses %s', (failure) => {
    const { input, receipts, wire } = sameHandFixture();
    if (failure === 'missing-flop') wire.shift();
    if (failure === 'duplicate-turn') wire.push(naturalWire(4, 3100));
    if (failure === 'replayed-flop') Object.assign(wire[0].message.payload, { replayed: true });
    if (failure === 'multiple-board')
      wire[0].message.payload.board2.push('PUBLIC_VALUE_NOT_EXPORTED');
    if (failure === 'foreign-table') wire[0].message.tableId = 'other';
    if (failure === 'late-face') input.exposures[4].firstEligibleAt = 6101;
    if (failure === 'other-hand-hole') input.exposures.at(-1)!.hand = 43;
    if (failure === 'other-hand-river') receipts[1].hand = 43;
    if (failure === 'same-id-board') input.exposures[4].id = input.exposures[3].id;
    expect(cardArtworkSameHandEvidence(input, receipts, wire, 'table').verdict).toBe('unknown');
  });
});
