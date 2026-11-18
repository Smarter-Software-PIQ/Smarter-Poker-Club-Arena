/**
 * The re-raise response record (HorseOmahaReraiseResponse): what one hand teaches, how the record ages, its
 * validation and wire row, the posterior against a prior, and the parity vectors the database twin is held to
 * (scripts/ci/fixtures/horse-reraise-response-vectors.json, scripts/ci/test-horse-exact-public-memory.py).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPLOIT_DECAY, EXPLOIT_HALF_LIFE_HANDS } from './HorseOpponentExploit.js';
import {
  RERAISE_RESPONSE_ROW_LENGTH,
  addReraiseResponseEvidence,
  copyReraiseResponse,
  emptyReraiseResponse,
  reraiseResponseCarriedFor,
  reraiseResponseFromRow,
  reraiseResponseNodeOf,
  reraiseResponsePosterior,
  reraiseResponseRow,
  validReraiseResponse,
} from './HorseOmahaReraiseResponse.js';
import {
  RERAISE_VECTOR_NAMED,
  buildReraiseResponseVectors,
  engineReraiseResponseIncrements,
} from './HorseOmahaReraiseResponse.test-support.js';
import { copyReraiseResponseRecord } from './HorseOpponentMemory.js';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const named = (name: string) =>
  engineReraiseResponseIncrements(
    RERAISE_VECTOR_NAMED.find((v) => v.name.startsWith(name))!.actions
  );

describe('what one hand teaches', () => {
  it('a 3-bettor who is 4-bet: one opportunity and his answer (call, fold, raise)', () => {
    expect(named('a 3-bettor is 4-bet and calls')).toEqual({ [B]: [1, 0, 1, 0, 0, 0, 0, 0] });
    expect(named('a 3-bettor is 4-bet and folds')).toEqual({ [B]: [1, 1, 0, 0, 0, 0, 0, 0] });
    // his 5-bet is the 3-bettor's answer (raise); the 4-bettor's call of it is the second node
    expect(named('a 3-bettor is 4-bet and 5-bets')).toEqual({
      [B]: [1, 0, 0, 1, 0, 0, 0, 0],
      [A]: [0, 0, 0, 0, 1, 0, 1, 0],
    });
  });
  it('a full-raise all-in is a raise; any other all-in is a call', () => {
    expect(named('a full-raise all-in')).toEqual({ [B]: [1, 0, 1, 0, 0, 0, 0, 0] });
  });
  it('not an opportunity: two raises back to him; an opener who is 3-bet; an unattributed or forced action; the flop', () => {
    expect(named('two raises come back')).toEqual({});
    expect(named('an opener who is 3-bet')).toEqual({});
    expect(named('an unattributed fold')).toEqual({});
  });
  it('hole cards in the log change nothing (public actions only)', () => {
    expect(named('hole cards in the log')).toEqual(named('a 3-bettor is 4-bet and calls'));
  });
  it('the node of a raise level: a 3-bet is the second raise; a 4-bet or more shares one node', () => {
    expect([0, 1, 2, 3, 4, 7].map(reraiseResponseNodeOf)).toEqual([
      null,
      null,
      'threeBetFacesFourBet',
      'fourBetFacesFiveBet',
      'fourBetFacesFiveBet',
      'fourBetFacesFiveBet',
    ]);
  });
});

describe('ageing, validity and the wire row', () => {
  const inc = (digits: string) => reraiseResponseFromRow([...digits].map(Number))!;
  it('ages like the opportunity-gated preflop counters: half-life 30, only the node that had an opportunity', () => {
    expect(EXPLOIT_HALF_LIFE_HANDS).toBe(30);
    let r = addReraiseResponseEvidence(null, inc('10100000'))!;
    r = addReraiseResponseEvidence(r, inc('00001010'))!;
    // the first node did not age on a hand that gave it no opportunity
    expect(reraiseResponseRow(r)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    r = addReraiseResponseEvidence(r, inc('11000000'))!;
    expect(r.threeBetFacesFourBet).toEqual({
      opp: EXPLOIT_DECAY + 1,
      fold: 1,
      call: EXPLOIT_DECAY,
      raise: 0,
    });
    expect(r.fourBetFacesFiveBet).toEqual({ opp: 1, fold: 0, call: 1, raise: 0 });
  });
  it('a hand with no opportunity leaves the record exactly as it was; inputs are never mutated', () => {
    const base = addReraiseResponseEvidence(null, inc('10100000'))!;
    const frozen = JSON.stringify(base);
    expect(addReraiseResponseEvidence(base, emptyReraiseResponse())).toBe(base);
    expect(addReraiseResponseEvidence(null, emptyReraiseResponse())).toBeNull();
    expect(addReraiseResponseEvidence(null, null)).toBeNull();
    addReraiseResponseEvidence(base, inc('11000000'));
    expect(JSON.stringify(base)).toBe(frozen);
  });
  it('valid: the exact shape, finite non-negative numbers, answers never above opportunities', () => {
    const ok = inc('10100000');
    expect(validReraiseResponse(ok)).toBe(true);
    expect(validReraiseResponse(copyReraiseResponse(ok))).toBe(true);
    for (const bad of [
      null,
      7,
      [],
      {},
      { ...ok, extra: 1 },
      { threeBetFacesFourBet: ok.threeBetFacesFourBet },
      { ...ok, threeBetFacesFourBet: { opp: 1, fold: 1, call: 1, raise: 0 } },
      { ...ok, threeBetFacesFourBet: { opp: 1, fold: -1, call: 0, raise: 0 } },
      { ...ok, threeBetFacesFourBet: { opp: 1, fold: '0', call: 0, raise: 0 } },
      { ...ok, fourBetFacesFiveBet: { opp: Infinity, fold: 0, call: 0, raise: 0 } },
      { ...ok, fourBetFacesFiveBet: { opp: 1, fold: 0, call: 0 } },
    ])
      expect(validReraiseResponse(bad), JSON.stringify(bad)).toBe(false);
  });
  it('the wire row: 8 numbers, round trip, and a bad row decodes to null', () => {
    const r = addReraiseResponseEvidence(inc('10100000'), inc('10011010'))!;
    expect(reraiseResponseRow(r)).toHaveLength(RERAISE_RESPONSE_ROW_LENGTH);
    expect(reraiseResponseFromRow(reraiseResponseRow(r))).toEqual(r);
    expect(reraiseResponseFromRow([1, 1, 1, 0, 0, 0, 0, 0])).toBeNull();
    expect(reraiseResponseFromRow([1, 0, 1])).toBeNull();
  });
  it('a stored profile keeps the record only when well formed: absent stays absent, null stays null, malformed is dropped (the engine before the column exists)', () => {
    const ok = inc('10100000');
    expect(copyReraiseResponseRecord({})).toEqual({});
    expect(copyReraiseResponseRecord({ reraise_response: null })).toEqual({
      reraise_response: null,
    });
    expect(copyReraiseResponseRecord({ reraise_response: { x: 1 } })).toEqual({});
    const kept = copyReraiseResponseRecord({ reraise_response: ok });
    expect(kept).toEqual({ reraise_response: ok });
    expect(kept.reraise_response).not.toBe(ok);
  });
  it('carried for Omaha rows only', () => {
    expect(['plo4', 'plo5', 'plo6', 'flo8'].map(reraiseResponseCarriedFor)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['nlh', '', null, undefined].map(reraiseResponseCarriedFor)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the posterior against a population prior', () => {
  const prior = { fold: 0.014, call: 0.744, raise: 0.242 };
  it('no record or no opportunity at the node: the prior itself, labelled population', () => {
    for (const row of [null, undefined, emptyReraiseResponse()]) {
      const p = reraiseResponsePosterior(row, 'threeBetFacesFourBet', prior, 6)!;
      expect([p.fold, p.call, p.raise, p.opportunities, p.source]).toEqual([
        0.014,
        0.744,
        0.242,
        0,
        'population',
      ]);
    }
  });
  it('his own counts pull the rates: (count + mass x prior) / (answers + mass); the three sum to 1', () => {
    const row = reraiseResponseFromRow([20, 0, 17, 3, 0, 0, 0, 0])!;
    const p = reraiseResponsePosterior(row, 'threeBetFacesFourBet', prior, 6)!;
    expect(p.source).toBe('measured');
    expect(p.opportunities).toBe(20);
    expect(p.fold).toBeCloseTo((0 + 6 * 0.014) / 26, 12);
    expect(p.call).toBeCloseTo((17 + 6 * 0.744) / 26, 12);
    expect(p.raise).toBeCloseTo((3 + 6 * 0.242) / 26, 12);
    expect(p.fold + p.call + p.raise).toBeCloseTo(1, 12);
    // the other node is untouched by this one's evidence
    expect(reraiseResponsePosterior(row, 'fourBetFacesFiveBet', prior, 6)!.source).toBe(
      'population'
    );
  });
  it('a prior that is not three probabilities summing to 1, or a mass that is not positive, answers null', () => {
    expect(
      reraiseResponsePosterior(null, 'threeBetFacesFourBet', { fold: 0.5, call: 0.6, raise: 0 }, 6)
    ).toBeNull();
    expect(
      reraiseResponsePosterior(null, 'threeBetFacesFourBet', { fold: -0.1, call: 1.1, raise: 0 }, 6)
    ).toBeNull();
    expect(reraiseResponsePosterior(null, 'threeBetFacesFourBet', prior, 0)).toBeNull();
  });
});

describe('the parity vectors the database twin is held to', () => {
  it('the committed file is exactly what the engine computes (regenerate with scripts/generate-horse-reraise-response-vectors.ts)', () => {
    const file = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../scripts/ci/fixtures/horse-reraise-response-vectors.json'
        ),
        'utf8'
      )
    );
    const now = JSON.parse(JSON.stringify(buildReraiseResponseVectors()));
    expect(file).toEqual(now);
    expect(
      now.random.filter((r: { expected: object }) => Object.keys(r.expected).length > 0).length
    ).toBeGreaterThanOrEqual(30);
  });
});
