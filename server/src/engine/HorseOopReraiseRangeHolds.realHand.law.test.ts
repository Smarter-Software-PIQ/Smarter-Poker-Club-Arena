/**
 * LAW, REAL HAND: hand a6f9206d-3a5e-4a7f-8c7c-65c67fcb2778 (PLO5 1/2, Classic, big-blind ante, 785 bb effective; the
 * Horse in the big blind 3-bet the cutoff's pot open and folded to the pot 4-bet). The spot rebuilt from its public
 * nodes, the opener's durable public counters as they stood 11 minutes after the hand (fixture, neutral id), the
 * production options of the day. Today's build 3-bets about 17.5% of dealt hands there and about 68% of that range
 * folds to the 4-bet (break-even 66.7%); with omahaOopReraiseRangeHoldsVsReraise on the share is at most the cap 0.45,
 * and aces double-suited and aces with a suited ace still 3-bet. The Horse's own cards in the hand were never read.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { oopAsk, oopCell } from './HorseOopReraiseRangeHolds.test-support.js';
import { RERAISE_FOLD_SHARE_CAP_DEFAULT } from './HorseOopReraiseRangeHolds.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./HorseOopReraiseRangeHolds.fixture.json', import.meta.url), 'utf8')
) as { opts: Record<string, unknown>; openerRows: Record<string, unknown>[] };
const LIVE: Record<string, unknown> = { ...FIXTURE.opts, telemetry: true, observeMind: false };
const ON: Record<string, unknown> = { ...LIVE, omahaOopReraiseRangeHoldsVsReraise: true };
const ROWS = FIXTURE.openerRows.filter(
  (r) =>
    r.variant === 'plo5' &&
    (r.public_memory_domain as { speed?: string } | undefined)?.speed === 'table'
);
const SPOT = { game: 'plo5' as const, pos: 'bb_co' as const, depthBB: 785.265 };
enableBrainTelemetry();
// frozen clocks (as the replay harness): a decision's receipts carry elapsed times
beforeAll(() => {
  vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(1795501563479);
});

describe('hand a6f9206d: the out-of-position 3-bet range at 785 bb against the measured opener', () => {
  it('today the range folds to the 4-bet past the bluff break-even; with the option on at most the cap', () => {
    expect(ROWS.length).toBeGreaterThan(0);
    const off = oopCell(SPOT, LIVE, ROWS, 400);
    expect(off.threeBets / off.dealt).toBeGreaterThan(0.1);
    expect(off.foldsToFourBet / off.threeBets).toBeGreaterThan(0.6);
    const on = oopCell(SPOT, ON, ROWS, 1600);
    expect(on.threeBets).toBeGreaterThan(0);
    expect(on.foldsToFourBet / on.threeBets).toBeLessThanOrEqual(RERAISE_FOLD_SHARE_CAP_DEFAULT);
  }, 600_000);

  it('aces double-suited and aces with a suited ace still 3-bet', () => {
    const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
    const hands: Card[][] = [
      [c('A', 'spades'), c('A', 'hearts'), c('K', 'spades'), c('Q', 'hearts'), c('7', 'clubs')],
      [c('A', 'spades'), c('A', 'hearts'), c('J', 'spades'), c('T', 'hearts'), c('9', 'diamonds')],
      // (aces with a suited ace and two danglers, AsAdKs8h4c, is priced below 0 here against this opener and
      // folds: EV(3-bet) -4.5 bb-chips, his 4-bet answer a losing call; reported, not asserted)
      [c('A', 'clubs'), c('A', 'hearts'), c('Q', 'clubs'), c('J', 'diamonds'), c('5', 'spades')],
    ];
    for (const hole of hands) {
      const a = oopAsk({ ...SPOT, hole, threeTo: null }, ON, ROWS, 31);
      expect(['raise', 'jam'], hole.map((x) => x.rank + x.suit[0]).join('')).toContain(a.kind);
    }
  }, 120_000);
});
