import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  installNaturalBoardReveal,
  naturalBoardRevealEvidence,
  naturalBoardRevealIntervalsEvidence,
  type RevealReceipt,
} from '../e2e/support/naturalBoardReveal';
import type { EngineFrame } from '../e2e/support/liveTableRealtime';

it('retains natural reveal receipts even when the production case passes', () => {
  const workflow = parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
  type Step = { if?: string; with?: { name?: string; path?: string } };
  const artifact = Object.values(workflow.jobs as Record<string, { steps?: Step[] }>)
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.with?.name === 'mobile-live-table-proof');
  expect(artifact?.if).toBe("always() && steps.live.outputs.ready == 'true'");
  expect(artifact?.with?.path).toContain('test-results/live-table-realtime/**/mobile-live-table-*');
  const spec = readFileSync('tests/e2e/production-live-table-realtime.spec.ts', 'utf8');
  expect(spec).toMatch(
    /testInfo\.outputPath\(\s*'mobile-live-table-natural-board-reveal\.json'\s*,?\s*\)/
  );
  expect(spec).toMatch(/writeFileSync\(\s*boardEvidencePath\s*,/);
});
let callbacks: FrameRequestCallback[], angle: number, currentTime: number, finished: boolean;
const frame = () => {
  vi.advanceTimersByTime(16);
  callbacks.shift()!(performance.now());
};
const card = (squeeze = false) =>
  `<div class="community-cards__card ${squeeze ? 'card-squeeze-host' : ''}" data-rs-profile="normal-mobile">${squeeze ? '<div class="card-squeeze"><div class="card-squeeze__face--back"></div><div class="card-squeeze__face--front"></div></div>' : '<div class="card-image"></div>'}</div>`;
const add = (squeeze = true) =>
  document
    .querySelector('.community-cards__container')!
    .insertAdjacentHTML('beforeend', card(squeeze));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  callbacks = [];
  angle = 0;
  currentTime = 0;
  finished = false;
  document.body.innerHTML =
    '<span class="header-hand-number">#42</span><div class="community-cards"><div class="community-cards__container">' +
    card() +
    card() +
    card() +
    '</div></div>';
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 300,
    height: 80,
  } as DOMRect);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('getComputedStyle', () => ({
    transform: 'matrix3d(1)',
    backfaceVisibility: 'hidden',
    visibility: 'visible',
    display: 'block',
    opacity: '1',
  }));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m11 = Math.cos((angle * Math.PI) / 180);
      m13 = Math.sin((angle * Math.PI) / 180);
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        animationName: 'ccCardSqueeze',
        currentTime,
        playState: finished ? 'finished' : 'running',
        effect: { getComputedTiming: () => ({ endTime: 350 }) },
      },
    ],
  });
});
afterEach(() => {
  window.__naturalBoardReveal?.stop();
  delete window.__naturalBoardReveal;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const wire = (receipt: RevealReceipt, patch: Record<string, unknown> = {}): EngineFrame => ({
  at: receipt.at,
  direction: 'received',
  socketId: 1,
  message: {
    type: 'EVENT',
    payload: {
      type: 'community_cards_dealt',
      table_id: 'table',
      hand_number: 42,
      board: Array(receipt.to).fill('PUBLIC'),
      board2: [],
      board3: [],
      ...patch,
    },
  },
});
it('the actual rAF observer captures natural same-hand turn and river through the owed animation', () => {
  const handLabel = document.querySelector('.header-hand-number')!;
  handLabel.className = 'table-brand__hand';
  handLabel.textContent = 'Hand #42';
  installNaturalBoardReveal(10000);
  frame();
  frame();
  for (const to of [4, 5]) {
    add();
    angle = 0;
    currentTime = 0;
    finished = false;
    frame();
    angle = 180;
    currentTime = 350;
    finished = true;
    frame();
    frame();
    expect(window.__naturalBoardReveal!.receipts.at(-1)!.to).toBe(to);
  }
  const receipts = window.__naturalBoardReveal!.stop();
  expect(receipts.map((r) => r.outcome)).toEqual(['complete', 'complete']);
  const result = naturalBoardRevealEvidence(
    receipts,
    receipts.map((r) => wire(r)),
    'table'
  );
  expect(result.verdict).toBe('qualified');
  expect(JSON.stringify(result)).not.toContain('PUBLIC');
});
it('records the old first bare-face opportunity as a violation even if a squeeze appears later', () => {
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add(false);
  frame();
  const receipts = window.__naturalBoardReveal!.stop();
  expect(
    naturalBoardRevealEvidence(
      receipts,
      receipts.map((r) => wire(r)),
      'table'
    ).verdict
  ).toBe('violation');
});
it.each(['initial mount', 'hidden', 'hand changed', 'two boards', 'unfocused'])(
  'does not qualify %s as a natural transition',
  (mode) => {
    if (mode === 'initial mount') add();
    installNaturalBoardReveal(10000);
    frame();
    frame();
    if (mode === 'hidden')
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    if (mode === 'hand changed') document.querySelector('.header-hand-number')!.textContent = '#43';
    if (mode === 'two boards')
      document.body.insertAdjacentHTML('beforeend', '<div class="community-cards"></div>');
    if (mode === 'unfocused') vi.mocked(document.hasFocus).mockReturnValue(false);
    if (mode !== 'initial mount') add();
    frame();
    expect(window.__naturalBoardReveal!.stop()).toEqual([]);
  }
);
it('an interrupted animation and replayed, wrong-hand or multi-board wire facts remain unknown', () => {
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add();
  frame();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  frame();
  const receipts = window.__naturalBoardReveal!.stop();
  expect(receipts[0]!.outcome).toBe('interrupted');
  for (const patch of [
    { replayed: true },
    { hand_number: 43 },
    { board2: ['PUBLIC'] },
    { table_id: 'other' },
  ])
    expect(naturalBoardRevealEvidence(receipts, [wire(receipts[0]!, patch)], 'table').verdict).toBe(
      'unknown'
    );
});

it('a reconnect snapshot or replacement transport cannot qualify a first-frame receipt', () => {
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add();
  frame();
  const receipts = window.__naturalBoardReveal!.stop();
  const event = wire(receipts[0]!);
  for (const extra of [
    { ...event, message: { type: 'SNAPSHOT' } },
    { ...event, socketId: 2 },
  ]) {
    const result = naturalBoardRevealEvidence(receipts, [event, extra], 'table');
    expect(result.verdict).toBe('unknown');
    expect(result.receipts).toEqual([]);
  }
});

it('reduced motion is unknown rather than a bare-face violation', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add(false);
  frame();
  const receipts = window.__naturalBoardReveal!.stop();
  expect(
    naturalBoardRevealEvidence(
      receipts,
      receipts.map((r) => wire(r)),
      'table'
    ).verdict
  ).toBe('unknown');
});
it('different hands cannot combine into a qualified turn and river', () => {
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add();
  frame();
  angle = 180;
  currentTime = 350;
  finished = true;
  frame();
  const turn = window.__naturalBoardReveal!.stop()[0]!;
  const river = { ...turn, hand: 43, from: 4, to: 5 };
  expect(
    naturalBoardRevealEvidence(
      [turn, river],
      [wire(turn), wire(river, { hand_number: 43 })],
      'table'
    ).verdict
  ).toBe('unknown');
});

const completeStreet = (to: number, firstHost = true): RevealReceipt => ({
  hand: 42,
  from: to - 1,
  to,
  at: to * 1000,
  outcome: 'complete',
  frames: [
    {
      at: to * 1000,
      host: firstHost,
      back: true,
      front: true,
      profile: 'mobile',
      angle: 0,
      currentTime: 0,
      endTime: 350,
      finished: false,
      faceStylesValid: true,
      reducedMotion: false,
    },
    {
      at: to * 1000 + 350,
      host: true,
      back: true,
      front: true,
      profile: 'mobile',
      angle: 180,
      currentTime: 350,
      endTime: 350,
      finished: true,
      faceStylesValid: true,
      reducedMotion: false,
    },
  ],
});

it('post-reconnect existing observations can qualify without combining across the outage', () => {
  const turn = completeStreet(4),
    river = completeStreet(5);
  const result = naturalBoardRevealIntervalsEvidence(
    [
      { name: 'before-outage', receipts: [], frames: [] },
      { name: 'after-reconnect', receipts: [turn, river], frames: [wire(turn), wire(river)] },
    ],
    'table'
  );
  expect(result.verdict).toBe('qualified');
  expect(result.intervals.map((interval) => interval.verdict)).toEqual(['unknown', 'qualified']);
  expect(JSON.stringify(result)).not.toContain('PUBLIC');
});

it('even the same hand cannot combine a pre-outage turn with a post-reconnect river', () => {
  const turn = completeStreet(4),
    river = completeStreet(5);
  expect(
    naturalBoardRevealIntervalsEvidence(
      [
        { name: 'before-outage', receipts: [turn], frames: [wire(turn)] },
        { name: 'after-reconnect', receipts: [river], frames: [wire(river)] },
      ],
      'table'
    ).verdict
  ).toBe('unknown');
});

it('an admitted violation in either interval dominates a complete clean interval', () => {
  const turn = completeStreet(4),
    river = completeStreet(5),
    bad = completeStreet(4, false);
  for (const earlier of [true, false]) {
    const good = { receipts: [turn, river], frames: [wire(turn), wire(river)] };
    const violation = { receipts: [bad], frames: [wire(bad)] };
    expect(
      naturalBoardRevealIntervalsEvidence(
        [
          { name: 'before-outage', ...(earlier ? violation : good) },
          { name: 'after-reconnect', ...(earlier ? good : violation) },
        ],
        'table'
      ).verdict
    ).toBe('violation');
  }
});

it('snapshots and multiple transports poison only their own interval and never create coverage', () => {
  const turn = completeStreet(4),
    river = completeStreet(5);
  for (const extra of [
    { ...wire(turn), message: { type: 'SNAPSHOT' } },
    { ...wire(turn), socketId: 2 },
  ]) {
    const result = naturalBoardRevealIntervalsEvidence(
      [
        { name: 'before-outage', receipts: [turn], frames: [wire(turn)] },
        {
          name: 'after-reconnect',
          receipts: [turn, river],
          frames: [wire(turn), wire(river), extra],
        },
      ],
      'table'
    );
    expect(result.verdict).toBe('unknown');
    expect(result.intervals[1].transportContinuity).toBe('unproven');
    expect(result.intervals[1].receipts).toEqual([]);
  }
});

it('retains an unknown empty observation and refuses duplicate or unbounded intervals', () => {
  expect(naturalBoardRevealIntervalsEvidence([], 'table')).toMatchObject({
    verdict: 'unknown',
    intervals: [],
  });
  const empty = { name: 'before-outage' as const, receipts: [], frames: [] };
  expect(() => naturalBoardRevealIntervalsEvidence([empty, empty], 'table')).toThrow();
  expect(() => naturalBoardRevealIntervalsEvidence([empty, empty, empty], 'table')).toThrow();
  const spec = readFileSync('tests/e2e/production-live-table-realtime.spec.ts', 'utf8');
  expect(spec).toMatch(
    /finally \{\s*await stopBoardInterval\(\);[\s\S]*?const boardEvidence = naturalBoardRevealIntervalsEvidence/
  );
  expect(spec).toMatch(/await stopBoardInterval\(\);\s*await page\.reload/);
});

it('retains a delayed first sample gap without qualifying a finished first frame', () => {
  installNaturalBoardReveal(10000);
  frame();
  frame();
  add();
  vi.advanceTimersByTime(400);
  angle = 180;
  currentTime = 350;
  finished = true;
  frame();
  const receipts = window.__naturalBoardReveal!.stop();
  expect(receipts[0].baselineFrames).toBe(2);
  expect(receipts[0].frames[0].rafGapMs).toBe(416);
  expect(receipts[0].frames[0].finished).toBe(true);
  expect(
    naturalBoardRevealEvidence(
      receipts,
      receipts.map((r) => wire(r)),
      'table'
    ).verdict
  ).toBe('unknown');
});

it('captures and always retains both existing intervals in the shared MTT SPIN SNG path', () => {
  const spec = readFileSync('tests/e2e/production-live-table-realtime.spec.ts', 'utf8');
  const shared = spec.slice(
    spec.indexOf('async function observeTournamentBoard('),
    spec.indexOf("test.describe('production mobile")
  );
  expect(shared).toMatch(/page.evaluate\(installNaturalBoardReveal, observationDeadline\)/);
  expect(shared.indexOf("await startBoardInterval('before-outage')")).toBeLessThan(
    shared.indexOf('const progressStartedAt')
  );
  expect(shared).toMatch(
    /await stopBoardInterval\(\);\s*try \{\s*await context.setOffline\(true\)/
  );
  expect(shared.indexOf("await startBoardInterval('after-reconnect')")).toBeGreaterThan(
    shared.indexOf('const restoredAt')
  );
  expect(shared.indexOf("await startBoardInterval('after-reconnect')")).toBeLessThan(
    shared.indexOf('const recoveredProgressStartedAt')
  );
  expect(shared).toMatch(
    /finally \{\s*await stopBoardInterval\(\);[\s\S]*?const boardEvidence = naturalBoardRevealIntervalsEvidence/
  );
  expect(shared).toContain('mobile-live-table-${tag}-natural-board-reveal.json');
  expect(shared).toMatch(/writeFileSync\(\s*boardEvidencePath,/);
});
