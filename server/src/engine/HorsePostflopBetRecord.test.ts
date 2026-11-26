/**
 * The postflop bet record (HorsePostflopBetRecord): the engine reducer, its parity fixture with the database twin, the
 * add rule, validation and the read-frame row. Public actions and the public showdown list only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POSTFLOP_BETS_ROW_LENGTH,
  addPostflopBetEvidence,
  emptyPostflopBets,
  postflopBetHandIncrements,
  postflopBetsFromRow,
  postflopBetsRow,
  postflopSizeBucket,
  raiseToBetShare,
  shownBetAir,
  validPostflopBets,
} from './HorsePostflopBetRecord.js';
import { EXPLOIT_DECAY } from './HorseOpponentExploit.js';
import {
  POSTFLOP_VECTOR_NAMED,
  buildPostflopBetVectors,
  enginePostflopBetIncrements,
} from './HorsePostflopBetRecord.test-support.js';

describe('the postflop bet record', () => {
  it('the committed parity vectors are what the engine computes (regenerate with the generator script)', () => {
    const file = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../scripts/ci/fixtures/horse-postflop-bets-vectors.json'),
        'utf8'
      )
    );
    expect(file).toEqual(JSON.parse(JSON.stringify(buildPostflopBetVectors())));
    for (const v of file.random)
      expect(v.expected).toEqual(enginePostflopBetIncrements(v.actions, v.showdown));
  });

  it('named hands: the raise cell, a called shown air bet, a mucked bet, forced and timeout folds', () => {
    const [airRiver, flopRaise, threeWay, forced] = POSTFLOP_VECTOR_NAMED.map((v) =>
      postflopBetHandIncrements(v.actions as never, v.showdown)
    );
    const A = '00000000-0000-4000-8000-0000000000e1';
    const B = '00000000-0000-4000-8000-0000000000e2';
    const C = '00000000-0000-4000-8000-0000000000e3';
    expect(airRiver.get(A)!.shownBet.river.large).toEqual({ called: 1, shown: 1, air: 1 });
    expect(airRiver.get(B)!.raiseToBet.river).toEqual({ opp: 1, raise: 0 });
    expect(flopRaise.get(B)!.raiseToBet.flop).toEqual({ opp: 1, raise: 1 });
    expect(flopRaise.has(A)).toBe(false); // A bet first: no opportunity; his fold faced a raise of his own bet
    expect(threeWay.get(C)!.raiseToBet.turn).toEqual({ opp: 1, raise: 1 });
    expect(threeWay.get(B)!.shownBet.river.large).toEqual({ called: 1, shown: 0, air: 0 }); // mucked: never read
    expect(threeWay.get(A)!.shownBet.turn.small).toEqual({ called: 1, shown: 0, air: 0 });
    expect(forced.size).toBe(0);
  });

  it('the size buckets are the shown-river buckets', () => {
    expect(postflopSizeBucket(1, 3)).toBe('small');
    expect(postflopSizeBucket(1, 2)).toBe('medium');
    expect(postflopSizeBucket(2, 3)).toBe('large');
    expect(postflopSizeBucket(1, 1)).toBe('large');
    expect(postflopSizeBucket(3, 2)).toBe('overbet');
  });

  it('a cell ages only on its own opportunity; no opportunity leaves the record (null stays null)', () => {
    const inc = emptyPostflopBets();
    inc.raiseToBet.turn = { opp: 1, raise: 1 };
    const one = addPostflopBetEvidence(null, inc)!;
    expect(one.raiseToBet.turn).toEqual({ opp: 1, raise: 1 });
    const inc2 = emptyPostflopBets();
    inc2.raiseToBet.river = { opp: 1, raise: 0 };
    const two = addPostflopBetEvidence(one, inc2)!;
    expect(two.raiseToBet.turn).toEqual({ opp: 1, raise: 1 }); // not aged
    const three = addPostflopBetEvidence(two, inc)!;
    expect(three.raiseToBet.turn.opp).toBeCloseTo(EXPLOIT_DECAY + 1, 12);
    expect(addPostflopBetEvidence(null, emptyPostflopBets())).toBeNull();
    expect(addPostflopBetEvidence(two, emptyPostflopBets())).toBe(two);
  });

  it('validation and the read-frame row round trip', () => {
    const r = emptyPostflopBets();
    r.raiseToBet.flop = { opp: 3.5, raise: 1.25 };
    r.shownBet.river.overbet = { called: 2, shown: 1.5, air: 0.5 };
    expect(validPostflopBets(r)).toBe(true);
    const row = postflopBetsRow(r);
    expect(row).toHaveLength(POSTFLOP_BETS_ROW_LENGTH);
    expect(postflopBetsFromRow(row)).toEqual(r);
    expect(validPostflopBets({ ...r, extra: 1 })).toBe(false);
    const bad = postflopBetsRow(r);
    bad[1] = 9; // raise above opportunities
    expect(postflopBetsFromRow(bad)).toBeNull();
    expect(validPostflopBets(null)).toBe(false);
  });

  it('the readers: no record reads the anchor; the record dominates as it grows; air needs something shown', () => {
    expect(raiseToBetShare(null, 'turn', 0.1)).toEqual({ share: 0.1, n: 0 });
    const r = emptyPostflopBets();
    r.raiseToBet.turn = { opp: 200, raise: 100 };
    expect(raiseToBetShare(r, 'turn', 0.1).share).toBeGreaterThan(0.45);
    expect(shownBetAir(r, 'river', 'large')).toBeNull();
    r.shownBet.river.large = { called: 10, shown: 8, air: 4 };
    expect(shownBetAir(r, 'river', 'large')).toEqual({ air: 0.5, shown: 8 });
  });
});
