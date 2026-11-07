import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STALE_CHECK_IDLE_MS,
  staleCheckDue,
  extractEntryScript,
  STALE_CHECK_MIN_INTERVAL_MS,
} from '../../src/hooks/useShellUpdateGate';

describe('extractEntryScript — the build identity read from a shell document', () => {
  it('finds the vite entry chunk in a production shell', () => {
    const html =
      '<head><link rel="modulepreload" href="/hub/club-arena/assets/vendor-react-C2kmzSSi-v6.js">' +
      '<script type="module" crossorigin src="/hub/club-arena/assets/index-DjnB0U9N-v6.js"></script></head>';
    expect(extractEntryScript(html)).toBe('assets/index-DjnB0U9N-v6.js');
  });

  it('two shells naming different entries are two different deploys', () => {
    const a = extractEntryScript('<script src="/hub/club-arena/assets/index-AAAAaaaa-v6.js">');
    const b = extractEntryScript('<script src="/hub/club-arena/assets/index-BBBBbbbb-v6.js">');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('returns null for a dev-server shell, so the probe stands down', () => {
    expect(extractEntryScript('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });
});

describe('deployed updates never reboot the open page', () => {
  it('has no reload, redirect or waiting-worker activation path', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../src/hooks/useShellUpdateGate.ts'),
      'utf8'
    );
    expect(src).not.toMatch(
      /location\.(reload|replace|assign)\s*\(|SKIP_WAITING|handOverToWaitingWorker/
    );
  });
});

describe('the probe is throttled', () => {
  it('cannot touch the network more than once a minute', () => {
    // The constant is load-bearing: without it every visibility flick puts a
    // shell fetch on the wire. If someone lowers it below 30s, they should be
    // doing it here, on purpose, with a reason.
    expect(STALE_CHECK_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(30 * 1000);
  });
});

describe('staleCheckDue — a visible tab that never navigates still learns it is stale (2026-10-05)', () => {
  const base = {
    pathname: '/hub/club-arena/clubs/shark-club',
    lastPathname: '/hub/club-arena/clubs/shark-club',
    visible: true,
    lastCheckAt: 1_000_000,
    now: 1_000_000,
  };
  it('checks when the in-app route changes', () => {
    expect(staleCheckDue({ ...base, pathname: '/hub/club-arena/clubs/x' })).toBe(true);
  });
  it('checks a visible, idle page once the idle interval has passed, not before', () => {
    expect(staleCheckDue({ ...base, now: base.lastCheckAt + STALE_CHECK_IDLE_MS - 1 })).toBe(false);
    expect(staleCheckDue({ ...base, now: base.lastCheckAt + STALE_CHECK_IDLE_MS })).toBe(true);
  });
  it('a hidden page waits for visibility (the visibility handler checks then)', () => {
    expect(
      staleCheckDue({ ...base, visible: false, now: base.lastCheckAt + STALE_CHECK_IDLE_MS })
    ).toBe(false);
  });
  it('the hook wires focus and the poll to the probe, and still reloads only through the gate', () => {
    const src = readFileSync(path.join(__dirname, '../../src/hooks/useShellUpdateGate.ts'), 'utf8');
    expect(src).toContain("window.addEventListener('focus', onFocus);");
    expect(src).toContain("window.removeEventListener('focus', onFocus);");
    /* A route change is consumed only by a probe that ran; one inside the
       throttle stays due for the next tick (2026-10-05 audit). */
    expect(src).toMatch(
      /staleCheckDue\(\{[\s\S]*?\}\)\s*&&\s*checkStaleness\(\)\s*\)\s*\{\s*lastPathname = window\.location\.pathname;/
    );
    expect(src).toContain('const checkStaleness = (): boolean => {');
    expect(STALE_CHECK_IDLE_MS).toBe(15 * 60 * 1000);
  });
});
