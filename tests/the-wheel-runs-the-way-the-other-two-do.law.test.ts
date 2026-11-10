/** Paid wheel spins require an explicit press. Historical prepaid receipts still
 * use the shared presentation timer; Crash keeps its existing auto-play rules.
 * The component regressions exercise these behaviors with actual clicks. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AUTO_RUN_SIZES, autoRunVerdict, cycleRunSize } from '../src/utils/autoRun';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const WHEEL = src('src/pages/DiamondWheelPage.tsx');
const CRASH = src('src/pages/DiamondCrashPage.tsx');

describe('Crash retains its repeat-round runner', () => {
  it('uses the shared readiness and run size rules', () => {
    expect(CRASH).toContain('autoRunVerdict(');
    expect(CRASH).toContain('cycleRunSize');
  });

  const page = (over: Partial<{ busy: boolean; blocker: string | null; ready: boolean }> = {}) => ({
    busy: false,
    blocker: null as string | null,
    ready: true,
    ...over,
  });

  it('takes nothing but the page own readiness, and answers one of four things', () => {
    const run = { total: 5, done: 1 };
    expect(autoRunVerdict(run, page({ busy: true }), 700)).toEqual({ kind: 'wait' });
    expect(autoRunVerdict(run, page({ ready: false }), 700)).toEqual({ kind: 'wait' });
    expect(autoRunVerdict({ total: 5, done: 5 }, page(), 700)).toEqual({ kind: 'finished' });
    expect(autoRunVerdict(run, page({ blocker: 'Out Of Diamonds' }), 700)).toEqual({
      kind: 'blocked',
      why: 'Out Of Diamonds',
    });
    expect(autoRunVerdict(run, page(), 700)).toEqual({ kind: 'go', delayMs: 700 });
    // The first press is immediate; the pause exists to let a result be read.
    expect(autoRunVerdict({ total: 5, done: 0 }, page(), 700)).toEqual({ kind: 'go', delayMs: 0 });
  });

  it('and a verdict carries no prize, multiplier, slot or payout to carry', () => {
    const keys = new Set<string>();
    for (const v of [
      autoRunVerdict({ total: 2, done: 0 }, page(), 700),
      autoRunVerdict({ total: 2, done: 2 }, page(), 700),
      autoRunVerdict({ total: 2, done: 1 }, page({ blocker: 'Paused' }), 700),
      autoRunVerdict({ total: 2, done: 1 }, page({ busy: true }), 700),
    ]) {
      Object.keys(v).forEach((k) => keys.add(k));
    }
    expect([...keys].sort()).toEqual(['delayMs', 'kind', 'why']);
  });

  it('a run with no size never presses, and the sizes cycle back to Off', () => {
    expect(autoRunVerdict(null, page(), 700)).toEqual({ kind: 'wait' });
    let n: number = 0;
    const seen: number[] = [];
    for (let i = 0; i < AUTO_RUN_SIZES.length; i++) {
      n = cycleRunSize(n);
      seen.push(n);
    }
    expect(seen).toEqual([...AUTO_RUN_SIZES.slice(1), 0]);
  });
});

describe('paid wheel activity after run retirement', () => {
  it('exposes a single paid entry point and no way to start a new run', () => {
    expect(WHEEL).toContain('onClick: handleSpin');
    expect(WHEEL).not.toContain('WheelBatchService.begin(');
    expect(WHEEL).not.toContain('DiamondWheelService.runBegin(');
    expect(WHEEL).not.toContain('WHEEL_RUN_SIZES');
    expect(WHEEL).not.toContain('cycleRunSize');
  });

  it('opens an already paid run by reading its stored receipts', () => {
    expect(WHEEL).toContain('WheelBatchService.read(');
    const receipt = WHEEL.indexOf('const receipt = batch.receipts[autoRun.done]');
    expect(receipt).toBeGreaterThan(0);
    const presentationEffect = WHEEL.slice(receipt, WHEEL.indexOf('}, [', receipt));
    expect(presentationEffect).toContain('setPending(receipt)');
    expect(presentationEffect).not.toContain('handleSpin(');
    expect(WHEEL).toContain('tallyWheelRun(r, result, prizeLabel)');
  });
});
