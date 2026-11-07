/**
 * The last-hand wait of every break is measured (Dan 2026-11-06): from the
 * :55 last-hand call until a tournament's tables had all finished their hand
 * and its countdown started. Published on /health (breakLastHandWait) and
 * /metrics (poker_tournament_break_last_hand_wait_seconds).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'GameServer.ts'), 'utf8');
const body = (sig: string): string => {
  const at = SRC.indexOf(sig);
  expect(at, sig).toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf('\n  }\n', at));
};

describe('break last-hand wait metric', () => {
  it('is recorded only after the tournament has parked, before its countdown is stamped', () => {
    const run = body('private async runTournamentBreak(');
    const parked = run.indexOf('await this.waitForAllTablesParked([tm])');
    const record = run.indexOf(
      'this.recordBreakLastHandWait(breakGeneration, waitStartedAt, countdownStartsAt)'
    );
    const start = run.indexOf('await this.startTournamentBreakCountdown(');
    expect(parked).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(parked);
    expect(start).toBeGreaterThan(record);
  });

  it('keeps the slowest tournament per break and resets on a new break', () => {
    // Exercise the method body on a minimal stand-in.
    const method = body('private recordBreakLastHandWait(');
    const fnBody = method.slice(method.indexOf('{') + 1);
    const record = new Function(
      'breakGeneration',
      'calledAt',
      'countdownStartsAt',
      fnBody.replace(/: number/g, '')
    ) as (
      this: { breakLastHandWait: Record<string, number> },
      g: number,
      c: number,
      s: number
    ) => void;
    const self = {
      breakLastHandWait: { breakGeneration: 0, calledAt: 0, lastMs: -1, maxMs: -1, tournaments: 0 },
    };
    record.call(self, 1, 1000, 31_000);
    record.call(self, 1, 1000, 11_000);
    expect(self.breakLastHandWait).toMatchObject({
      breakGeneration: 1,
      lastMs: 10_000,
      maxMs: 30_000,
      tournaments: 2,
    });
    record.call(self, 2, 5000, 9000);
    expect(self.breakLastHandWait).toMatchObject({
      breakGeneration: 2,
      lastMs: 4000,
      maxMs: 4000,
      tournaments: 1,
    });
  });

  it('is published on /health and /metrics', () => {
    expect(SRC).toMatch(
      /breakLastHandWait: this\.breakLastHandWait \? \{ \.\.\.this\.breakLastHandWait \} : null/
    );
    expect(SRC).toMatch(/# TYPE poker_tournament_break_last_hand_wait_seconds gauge/);
  });
});
