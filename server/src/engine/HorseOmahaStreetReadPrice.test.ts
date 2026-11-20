/**
 * The price behind a fold-to-raise cell (HorseOmahaStreetReadPrice): the price of one opportunity from the public
 * action log and pot size, that the opportunity is the street read's own, the add rule, validation, the wire row
 * and the mean a consumer reads. The parity vectors the database twin is held to are in
 * scripts/ci/fixtures/horse-flop-shown-vectors.json (checked whole by HorseOmahaFlopShown.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { ExploitHandAction } from './HorseOpponentExploit.js';
import { STREET_READ_DECAY, streetReadHandIncrements } from './HorseOmahaStreetRead.js';
import {
  STREET_PRICE_ROW_LENGTH,
  addStreetPriceEvidence,
  copyStreetPrice,
  emptyStreetPrice,
  foldToRaisePrice,
  streetPriceFromRow,
  streetPriceRow,
  validStreetPrice,
  type StreetPriceCounters,
} from './HorseOmahaStreetReadPrice.js';
import {
  STREET_PRICE_VECTOR_NAMED,
  buildFlopShownVectors,
  decodeFlopShownLog,
  engineStreetPriceIncrements,
} from './HorseOmahaFlopShown.test-support.js';
import { copyStreetPriceRecord } from './HorseOpponentMemory.js';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const named = (prefix: string) => {
  const v = STREET_PRICE_VECTOR_NAMED.find((x) => x.name.startsWith(prefix));
  if (!v) throw new Error('no named vector: ' + prefix);
  return engineStreetPriceIncrements(v.actions, v.pot_size);
};

describe('the price of one fold-to-raise opportunity', () => {
  it('is what he must add over the pot he is offered: increment / (pot + call + increment)', () => {
    // pot 12 before the flop; A bets 10 (pot 22), B raises to 30: call 10, increment 20 -> 20 / (22 + 10 + 20).
    expect(named('a bettor is raised and folds')).toEqual({ [A]: [20 / 52, 1, 0, 0, 0, 0] });
    expect(named('the same raise called')).toEqual({ [A]: [20 / 52, 1, 0, 0, 0, 0] });
    expect(named('a caller in between')).toEqual({ [A]: [20 / 82, 1, 0, 0, 0, 0] });
  });
  it('is kept by street, counts a raiser who is raised back, and takes a returned bet off the pot', () => {
    // Turn: A bets 20 into 32, B raises to 60 (A: 40 over 112), A raises to 180 (B: 120 over 272).
    expect(named('a turn check-raise')).toEqual({
      [A]: [0, 0, 40 / 112, 1, 0, 0],
      [B]: [0, 0, 120 / 272, 1, 0, 0],
    });
  });
  it('adds nothing without a pot size, with a pot the streets do not fit, or for an answer that is not admitted', () => {
    expect(named('no pot size on the record')).toEqual({});
    expect(named('a pot size smaller')).toEqual({});
    expect(named('a forced fold is not an answer')).toEqual({});
    for (const junk of [null, 7, 'x', {}, [null, 7, 'x', {}]])
      expect(engineStreetPriceIncrements(junk, 100)).toEqual({});
    expect(engineStreetPriceIncrements([], Infinity)).toEqual({});
  });
  it('is priced only where the street read counts a fold-to-raise opportunity, on every random log', () => {
    let priced = 0;
    for (const v of buildFlopShownVectors().random) {
      const actions = decodeFlopShownLog(v.log);
      const street = streetReadHandIncrements(actions as unknown as ExploitHandAction[], null);
      for (const [id, row] of Object.entries(v.price)) {
        const cells = street.get(id)!.foldToRaise;
        [cells.flop, cells.turn, cells.river].forEach((c, i) => {
          expect(row[2 * i + 1]).toBeLessThanOrEqual(c.opp);
          if (row[2 * i + 1]) {
            priced++;
            expect(row[2 * i]).toBeGreaterThan(0);
            expect(row[2 * i]).toBeLessThanOrEqual(1);
          }
        });
      }
    }
    expect(priced).toBeGreaterThanOrEqual(40);
  });
});

describe('the record', () => {
  const inc = (flop: [number, number], turn: [number, number] = [0, 0]) => {
    const r = emptyStreetPrice();
    r.foldToRaise.flop = { sum: flop[0], opp: flop[1] };
    r.foldToRaise.turn = { sum: turn[0], opp: turn[1] };
    return r;
  };
  it('a cell that took a priced raise ages by the street read decay; the others and the arguments are untouched', () => {
    expect(addStreetPriceEvidence(null, null)).toBeNull();
    expect(addStreetPriceEvidence(null, emptyStreetPrice())).toBeNull();
    const one = addStreetPriceEvidence(null, inc([0.4, 1]))!;
    expect(streetPriceRow(one)).toEqual([0.4, 1, 0, 0, 0, 0]);
    const frozen = JSON.stringify(one);
    const two = addStreetPriceEvidence(one, inc([0.2, 1], [0.5, 1]))!;
    expect(streetPriceRow(two)).toEqual([
      0.4 * STREET_READ_DECAY + 0.2,
      STREET_READ_DECAY + 1,
      0.5,
      1,
      0,
      0,
    ]);
    expect(addStreetPriceEvidence(two, emptyStreetPrice())).toBe(two);
    expect(JSON.stringify(one)).toBe(frozen);
    const damaged = addStreetPriceEvidence(
      { foldToRaise: { flop: { sum: 'x', opp: [1] }, turn: 7 } } as never,
      inc([0.4, 1])
    )!;
    expect(streetPriceRow(damaged)).toEqual([0.4, 1, 0, 0, 0, 0]);
  });
  it('the mean is sum / opp, null where no raise was priced', () => {
    let r: ReturnType<typeof addStreetPriceEvidence> = null;
    for (const p of [0.3, 0.4, 0.5]) r = addStreetPriceEvidence(r, inc([p, 1]));
    const mean = foldToRaisePrice(r, 'flop')!;
    const d = STREET_READ_DECAY;
    expect(mean.price).toBeCloseTo((0.3 * d * d + 0.4 * d + 0.5) / (d * d + d + 1), 12);
    expect(mean.opportunities).toBeCloseTo(d * d + d + 1, 12);
    expect(foldToRaisePrice(r, 'turn')).toBeNull();
    expect(foldToRaisePrice(null, 'flop')).toBeNull();
    expect(foldToRaisePrice({ foldToRaise: {} } as never, 'flop')).toBeNull();
  });
  it('validation, the wire row and the stored copy', () => {
    const r = addStreetPriceEvidence(null, inc([0.4, 1]))!;
    expect(validStreetPrice(r)).toBe(true);
    expect(streetPriceRow(r)).toHaveLength(STREET_PRICE_ROW_LENGTH);
    expect(streetPriceFromRow(streetPriceRow(r))).toEqual(r);
    expect(streetPriceFromRow([1.5, 1, 0, 0, 0, 0])).toBeNull();
    expect(streetPriceFromRow([0.4, 1, 0, 0, 0])).toBeNull();
    for (const bad of [
      null,
      7,
      {},
      { foldToRaise: { flop: { sum: 0, opp: 0 } } },
      { ...r, x: 1 },
      { foldToRaise: { ...r.foldToRaise, flop: { sum: -1, opp: 1 } } },
    ])
      expect(validStreetPrice(bad)).toBe(false);
    const c = copyStreetPrice(r);
    c.foldToRaise.flop.sum = 9;
    expect(r.foldToRaise.flop.sum).toBe(0.4);
    expect(copyStreetPriceRecord({})).toEqual({});
    expect(copyStreetPriceRecord({ street_counters_price: null })).toEqual({
      street_counters_price: null,
    });
    expect(copyStreetPriceRecord({ street_counters_price: { foldToRaise: 1 } })).toEqual({});
    expect(copyStreetPriceRecord({ street_counters_price: r })).toEqual({
      street_counters_price: r,
    });
  });
  it('a stored or supplied number of 1e12 or more in size counts as 0 (review note N6, 20261119213206)', () => {
    const damaged = {
      foldToRaise: { flop: { sum: 1e400, opp: 1e308 }, turn: { sum: -1e13, opp: 5 } },
    } as unknown as StreetPriceCounters;
    expect(addStreetPriceEvidence(damaged, inc([0.4, 1]))!.foldToRaise).toEqual({
      flop: { sum: 0.4, opp: 1 },
      turn: { sum: 0, opp: 5 },
      river: { sum: 0, opp: 0 },
    });
    // a supplied count beyond the guard is no evidence: the base comes back as it was
    expect(addStreetPriceEvidence(null, inc([0.5, 1e12]))).toBeNull();
  });
  it('the named vectors use both players', () => {
    expect(Object.keys(named('a turn check-raise')).sort()).toEqual([A, B]);
  });
});
