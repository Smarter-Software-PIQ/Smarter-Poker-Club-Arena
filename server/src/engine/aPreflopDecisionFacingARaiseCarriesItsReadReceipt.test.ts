/**
 * LATER LAYERS KEEP THE STYLE READ, rule 6 (2026-11-15): THE PER-DECISION
 * READ RECEIPT (proposal accepted from the Human-vs-Horse lane, coordination
 * inbox 2026-11-15T01:00:31Z).
 *
 * Every preflop decision facing a raise now carries one bounded, journal-only
 * PreflopReadReceipt beside preflopAuthority: the noteLayer names the decision
 * heard (plus the maniac reads present), the bars it decided with, the same
 * bars with the style and maniac reads taken out (a rewound counterfactual:
 * no RNG drawn, no telemetry), the strength and the authority branch. The
 * maniac raise-width arithmetic writes its own receipt (consumer
 * 'maniac_price': required equity, equity, width). No decision changes: the
 * decisions here are pinned to the commit before the change.
 *
 * On these fixed inputs base differs from final exactly where a style layer
 * moved a bar or the maniac price decided; with no such read they are equal.
 */
import { describe, expect, it } from 'vitest';
import {
  install,
  preflopOpen,
  preflopThreeBet,
  riverBigBet,
  VILLAINS,
} from './HorseOpponentStyle.contexts.test-support.js';
import { decide, pinAll, seeds, supply } from './laterLayersKeepTheStyleRead.test-support.js';
import type { PreflopReadReceipt } from './HorsePreflop.js';

const RESPECT = { styleTightReRaiserRespect: true };
const run = (villain: string, spot: 'open' | '3bet', opts: Record<string, unknown>) =>
  seeds(20).map((s) => {
    install(VILLAINS[villain] ?? null, 'cash');
    supply(120);
    return decide(
      spot === 'open' ? preflopOpen('cash', 'AdJc') : preflopThreeBet('cash', 'AdJc'),
      opts,
      s
    );
  });
const moved = (r: PreflopReadReceipt) =>
  r.baseThreeBetThreshold !== r.threeBetThreshold ||
  r.baseCallThreshold !== r.callThreshold ||
  r.baseFourBetThreshold !== r.fourBetThreshold;
const receiptOf = (ds: ReturnType<typeof run>): PreflopReadReceipt => {
  // One receipt per decision; the layers and whether a bar moved do not
  // depend on the seed (the strength jitter does).
  for (const d of ds) expect(d.decision.preflopReadReceipt).toBeDefined();
  const r = ds[0]!.decision.preflopReadReceipt!;
  for (const d of ds) {
    expect(d.decision.preflopReadReceipt!.layers).toEqual(r.layers);
    expect(moved(d.decision.preflopReadReceipt!)).toBe(moved(r));
  }
  return r;
};

describe('a preflop decision facing a raise carries its read receipt', () => {
  it('the decisions themselves are unchanged (pinned to the commit before)', () => {
    expect(pinAll(run('none', 'open', {}))).toBe('4a75856cfc559ba3e20dd7ab');
    expect(pinAll(run('grinder', 'open', RESPECT))).toBe('a391200ee9ef4b11fb1561d3');
    expect(pinAll(run('grinder', '3bet', RESPECT))).toBe('e700ec2c23ca7caae50c9b61');
    expect(pinAll(run('maniac', '3bet', {}))).toBe('1e0240222dbf7fb0dfd1095b');
    expect(pinAll(run('maniac', 'open', {}))).toBe('ec5e913b6a9d90de35032bee');
  });

  it('no style or maniac read: base equals final', () => {
    for (const [v, spot, opts] of [
      ['none', 'open', {}],
      ['none', '3bet', RESPECT],
      ['grinder', 'open', {}],
      ['grinder', '3bet', {}],
      ['tag', '3bet', RESPECT],
    ] as const) {
      const r = receiptOf(run(v, spot, opts));
      expect(r.consumer).toBe('range_play');
      expect(moved(r), `${v} ${spot}`).toBe(false);
      expect(r.layers.some((l) => l.startsWith('style_') || l.startsWith('maniac_'))).toBe(false);
    }
  });

  it('the tight opener read: the 3-bet and call bars it raised, named', () => {
    const r = receiptOf(run('grinder', 'open', RESPECT));
    expect(r.layers).toContain('style_tight_opener_respect_seen');
    expect(r.callThreshold!).toBeGreaterThan(r.baseCallThreshold!);
    expect(r.threeBetThreshold!).toBeGreaterThanOrEqual(r.baseThreeBetThreshold!);
    expect(r.fourBetThreshold).toBeNull();
    expect(r.branch).toBe('strength_value');
    expect(typeof r.strength).toBe('number');
  });

  it('the tight re-raiser read: the 4-bet and call bars it raised, named', () => {
    const r = receiptOf(run('grinder', '3bet', RESPECT));
    expect(r.layers).toContain('style_tight_reraiser_respect_seen');
    expect(r.fourBetThreshold!).toBeGreaterThan(r.baseFourBetThreshold!);
    expect(r.callThreshold!).toBeGreaterThan(r.baseCallThreshold!);
    expect(r.threeBetThreshold).toBeNull();
  });

  it('the maniac raise-width consumer: the price arithmetic decided, with its width', () => {
    const r = receiptOf(run('maniac', '3bet', {}));
    expect(r.consumer).toBe('maniac_price');
    expect(r.layers).toEqual(['maniac_raise_width']);
    expect(r.baseCallThreshold).toBeNull();
    expect(r.callThreshold!).toBeGreaterThan(0);
    expect(r.maniacWidth!).toBeGreaterThan(0);
    expect(moved(r)).toBe(true);
    // Facing his single open the range play decides. The maniac read is named
    // and it moved a bar: it switches the V87 multiway defence widening off
    // (HorsePreflop def87Weight), so the call bar is higher than without it.
    const open = receiptOf(run('maniac', 'open', {}));
    expect(open.consumer).toBe('range_play');
    expect(open.layers).toContain('maniac_raise_width');
    expect(open.callThreshold!).toBeGreaterThan(open.baseCallThreshold!);
    expect(open.threeBetThreshold).toBe(open.baseThreeBetThreshold);
  });

  it('is small and only where a raise is faced', () => {
    for (const [v, spot, opts] of [
      ['grinder', 'open', RESPECT],
      ['maniac', '3bet', {}],
      ['grinder', '3bet', RESPECT],
    ] as const)
      expect(JSON.stringify(receiptOf(run(v, spot, opts))).length).toBeLessThan(512);
    install(VILLAINS.grinder!, 'cash');
    supply(120);
    expect(decide(riverBigBet('cash'), RESPECT, 1).decision.preflopReadReceipt).toBeUndefined();
  });
});
