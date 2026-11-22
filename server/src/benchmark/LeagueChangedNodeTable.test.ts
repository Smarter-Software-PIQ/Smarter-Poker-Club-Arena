import { describe, expect, it } from 'vitest';
import { changedNodeLabel, createChangedNodeCollector } from './LeagueChangedNodeTable.js';

type Ev = {
  seatIdx: number;
  stage: 'preflop' | 'flop' | 'turn' | 'river';
  action: string;
  toCall: number;
};

function feed(
  c: ReturnType<typeof createChangedNodeCollector>,
  pair: number,
  pass: 'pass1' | 'pass2',
  evs: Ev[]
) {
  const o = c.observer.hand(pair, pass);
  for (const e of evs) o.onAction!({ ...e, amount: 0, pot: 0, liveBefore: 2 });
}

describe('the per-node table of changed decisions', () => {
  it('labels a node by street, facing or checked to, and wagers already on the street', () => {
    expect(changedNodeLabel('river', 4, 1)).toBe('river/facing_1');
    expect(changedNodeLabel('flop', 0, 0)).toBe('flop/checked_to');
  });

  it('books each pair to the first hero decision the arms disagree on, and only there', () => {
    const c = createChangedNodeCollector(0);
    const common: Ev[] = [
      { seatIdx: 1, stage: 'preflop', action: 'raise', toCall: 1 },
      { seatIdx: 0, stage: 'preflop', action: 'call', toCall: 2 },
      { seatIdx: 1, stage: 'river', action: 'bet', toCall: 0 },
    ];
    // Pair 0: the hero raises the river bet on A and calls on B; A wins 4 more.
    feed(c, 0, 'pass1', [
      ...common,
      { seatIdx: 0, stage: 'river', action: 'raise', toCall: 4 },
      { seatIdx: 1, stage: 'river', action: 'call', toCall: 4 },
    ]);
    feed(c, 0, 'pass2', [...common, { seatIdx: 0, stage: 'river', action: 'call', toCall: 4 }]);
    c.observer.pair(0, 10, 6);
    // Pair 1: the same change, A loses 4 more.
    feed(c, 1, 'pass1', [...common, { seatIdx: 0, stage: 'river', action: 'raise', toCall: 4 }]);
    feed(c, 1, 'pass2', [...common, { seatIdx: 0, stage: 'river', action: 'call', toCall: 4 }]);
    c.observer.pair(1, -12, -8);
    // Pair 2: identical play and result.
    feed(c, 2, 'pass1', common);
    feed(c, 2, 'pass2', common);
    c.observer.pair(2, 3, 3);
    // Pair 3: the field's raise is not the hero's decision; the hero's preflop answer differs.
    feed(c, 3, 'pass1', [common[0], { seatIdx: 0, stage: 'preflop', action: 'fold', toCall: 2 }]);
    feed(c, 3, 'pass2', common);
    c.observer.pair(3, -1, 2);
    const t = c.table();
    expect(t.totalPairs).toBe(4);
    expect(t.divergentPairs).toBe(3);
    expect(t.changedPairs).toBe(3);
    expect(t.unexplained).toBe(0);
    expect(t.rows).toHaveLength(2);
    const river = t.rows.find((r) => r.node === 'river/facing_1')!;
    expect(river).toMatchObject({ actionA: 'raise', actionB: 'call', pairs: 2, meanBb: 0 });
    expect(river.stderrBb).toBeCloseTo(4, 10);
    const pre = t.rows.find((r) => r.node === 'preflop/facing_1')!;
    expect(pre).toMatchObject({ actionA: 'fold', actionB: 'call', pairs: 1, meanBb: -3 });
    // Row shares add up to the card's bb/100.
    expect(t.rows.reduce((s, r) => s + r.bb100Share, 0)).toBeCloseTo(((4 - 4 - 3) / 4) * 100, 10);
  });

  it('counts a result that differs with no changed hero decision as unexplained', () => {
    const c = createChangedNodeCollector(0);
    const evs: Ev[] = [{ seatIdx: 0, stage: 'preflop', action: 'call', toCall: 2 }];
    feed(c, 0, 'pass1', evs);
    feed(c, 0, 'pass2', evs);
    c.observer.pair(0, 1, 0);
    expect(c.table()).toMatchObject({ unexplained: 1, changedPairs: 0, rows: [] });
  });
});
