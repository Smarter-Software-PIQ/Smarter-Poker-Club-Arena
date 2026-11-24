import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  OPENER_FOUR_BET_BASELINE,
  OPENER_RESPONSE_PRIOR_MASS,
  addOpenerResponseEvidence,
  copyOpenerResponse,
  emptyOpenerResponse,
  openerFourBetRead,
  openerResponseCarriedFor,
  openerResponseFromRow,
  openerResponseHandIncrements,
  openerResponseRow,
  plannedFoldGuardWeight,
  validOpenerResponse,
  type OpenerResponseCounters,
} from './HorseOpenerAnswersThreeBet.js';
import {
  OPENER_VECTOR_NAMED,
  buildOpenerResponseVectors,
  engineOpenerResponseIncrements,
} from './HorseOpenerAnswersThreeBet.test-support.js';
import { EXPLOIT_DECAY } from './HorseOpponentExploit.js';
import { HorseMind } from './HorseMind.js';
import { copyOpenerResponseRecord } from './HorseOpponentMemory.js';

const A = '00000000-0000-4000-8000-0000000000b1';

afterEach(() => {
  HorseMind.setLearnsOpenerResponseInSandbox(false);
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('HorseOpenerAnswersThreeBet: the learner (public actions only)', () => {
  for (const v of OPENER_VECTOR_NAMED)
    it(v.name, () => {
      const got = engineOpenerResponseIncrements(v.actions);
      if (v.opener === null) expect(got).toEqual({});
      else expect(got).toEqual({ [A]: v.opener });
    });

  it('the committed parity vectors are what the engine computes (regenerate with the generator script)', () => {
    const file = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../scripts/ci/fixtures/horse-opener-response-vectors.json'
        ),
        'utf8'
      )
    );
    expect(file).toEqual(JSON.parse(JSON.stringify(buildOpenerResponseVectors())));
    const live = file.random.filter(
      (r: { expected: object }) => Object.keys(r.expected).length > 0
    );
    expect(live.length).toBeGreaterThanOrEqual(20);
  });

  it('nothing but the public log is read: no array, no entries, malformed entries', () => {
    expect(openerResponseHandIncrements(null).size).toBe(0);
    expect(openerResponseHandIncrements([] as never).size).toBe(0);
    expect(openerResponseHandIncrements([7, 'x', null, { userId: 5 }] as never).size).toBe(0);
  });
});

describe('HorseOpenerAnswersThreeBet: storage, ageing, validation', () => {
  it('a cell ages only on a hand that gave it an opportunity; null stays null without one', () => {
    expect(addOpenerResponseEvidence(null, emptyOpenerResponse())).toBeNull();
    const one = emptyOpenerResponse();
    one.inPosition = { opp: 1, fold: 0, call: 1, raise: 0 };
    const r1 = addOpenerResponseEvidence(null, one)!;
    const two = emptyOpenerResponse();
    two.outOfPosition = { opp: 1, fold: 0, call: 0, raise: 1 };
    const r2 = addOpenerResponseEvidence(r1, two)!;
    expect(r2.inPosition).toEqual(r1.inPosition);
    const r3 = addOpenerResponseEvidence(r2, one)!;
    expect(r3.inPosition.opp).toBeCloseTo(EXPLOIT_DECAY + 1, 12);
    expect(r3.inPosition.call).toBeCloseTo(EXPLOIT_DECAY + 1, 12);
    expect(r3.outOfPosition).toEqual(r2.outOfPosition);
    // never mutates its inputs
    expect(r1.inPosition).toEqual({ opp: 1, fold: 0, call: 1, raise: 0 });
  });

  it('the exact shape is valid; anything else is dropped from a stored copy', () => {
    const r = emptyOpenerResponse();
    expect(validOpenerResponse(r)).toBe(true);
    expect(validOpenerResponse({ ...r, extra: 1 })).toBe(false);
    expect(validOpenerResponse({ ...r, inPosition: { opp: 1, fold: 2, call: 0, raise: 0 } })).toBe(
      false
    );
    expect(validOpenerResponse({ ...r, inPosition: { opp: -1, fold: 0, call: 0, raise: 0 } })).toBe(
      false
    );
    expect(copyOpenerResponseRecord({})).toEqual({});
    expect(copyOpenerResponseRecord({ opener_response: null })).toEqual({ opener_response: null });
    expect(copyOpenerResponseRecord({ opener_response: { inPosition: 1 } })).toEqual({});
    expect(copyOpenerResponseRecord({ opener_response: r })).toEqual({ opener_response: r });
  });

  it('the read-frame row round-trips', () => {
    const r = emptyOpenerResponse();
    r.inPosition = { opp: 3.5, fold: 1, call: 2, raise: 0.5 };
    r.outOfPosition = { opp: 1, fold: 0, call: 0, raise: 1 };
    expect(openerResponseFromRow(openerResponseRow(r))).toEqual(r);
    expect(openerResponseFromRow([1, 2, 3])).toBeNull();
    expect(openerResponseFromRow([1, 2, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(copyOpenerResponse(r)).toEqual(r);
  });

  it('carried for nlh, plo4 and plo5 only', () => {
    expect(['nlh', 'plo4', 'plo5'].every(openerResponseCarriedFor)).toBe(true);
    expect(['plo6', 'flh', 'short_deck', '', null].some(openerResponseCarriedFor)).toBe(false);
  });
});

describe('HorseOpenerAnswersThreeBet: the anchored reader', () => {
  it('no record reads the baseline, and the guard binds in full', () => {
    const read = openerFourBetRead(null, 'outOfPosition', 0.5);
    expect(read).toMatchObject({ raise: OPENER_FOUR_BET_BASELINE, source: 'baseline', answers: 0 });
    expect(plannedFoldGuardWeight(read)).toBe(1);
  });

  it('his own record takes over as its sample grows; a player who never 4-bets lowers the guard', () => {
    let r: OpenerResponseCounters | null = null;
    const weights: number[] = [];
    for (let i = 0; i < 60; i++) {
      const inc = emptyOpenerResponse();
      inc.inPosition = { opp: 1, fold: 0, call: 1, raise: 0 };
      r = addOpenerResponseEvidence(r, inc);
      if (i === 4 || i === 29 || i === 59)
        weights.push(plannedFoldGuardWeight(openerFourBetRead(r, 'inPosition', 0.5)));
    }
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    const m = OPENER_RESPONSE_PRIOR_MASS;
    const n = r!.inPosition.fold + r!.inPosition.call + r!.inPosition.raise;
    expect(weights[2]).toBeCloseTo(m / (n + m), 12);
    // the other cell has no record: the baseline
    expect(plannedFoldGuardWeight(openerFourBetRead(r, 'outOfPosition', 0.5))).toBe(1);
  });

  it('a player who 4-bets at or above the baseline keeps the guard in full', () => {
    let r: OpenerResponseCounters | null = null;
    for (let i = 0; i < 40; i++) {
      const inc = emptyOpenerResponse();
      inc.outOfPosition =
        i % 4 === 0
          ? { opp: 1, fold: 0, call: 0, raise: 1 }
          : { opp: 1, fold: 1, call: 0, raise: 0 };
      r = addOpenerResponseEvidence(r, inc);
    }
    expect(plannedFoldGuardWeight(openerFourBetRead(r, 'outOfPosition', 0.5))).toBe(1);
  });
});

describe('HorseOpenerAnswersThreeBet: HorseMind', () => {
  const hand = [
    { userId: 'v', stage: 'preflop', action: 'raise', origin: 'player' },
    { userId: 'h', stage: 'preflop', action: 'raise', origin: 'horse_policy' },
    { userId: 'v', stage: 'preflop', action: 'call', origin: 'player' },
  ];
  const observe = (key: string, scope: 'holdem:hu' | 'omaha:hu', variant: string) =>
    HorseMind.observeHandComplete(
      key,
      hand,
      2,
      null,
      scope,
      false,
      { variant, boardCount: 1 } as never,
      undefined,
      'cash'
    );

  it('a benchmark sandbox learns its own hands; with the switch off nothing is kept', () => {
    const off = HorseMind.createSandbox();
    HorseMind.runInSandbox(off, () => observe('k1', 'holdem:hu', 'nlh'));
    expect(off.pooledOpenerResponse).toBeUndefined();
    HorseMind.setLearnsOpenerResponseInSandbox(true);
    const on = HorseMind.createSandbox();
    HorseMind.runInSandbox(on, () => observe('k2', 'holdem:hu', 'nlh'));
    const row = on.pooledOpenerResponse?.get('nlh:cash:hu|v');
    expect(row && openerResponseRow(row)).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
    // a game the record is not carried for learns nothing
    const plo6 = HorseMind.createSandbox();
    HorseMind.runInSandbox(plo6, () => observe('k3', 'omaha:hu', 'plo6'));
    expect(plo6.pooledOpenerResponse?.size ?? 0).toBe(0);
  });

  it('the decision reads the record of its own game, format and table size only', () => {
    const r = emptyOpenerResponse();
    r.inPosition = { opp: 2, fold: 0, call: 2, raise: 0 };
    const sb = HorseMind.createSandbox();
    sb.pooledOpenerResponse = new Map([['nlh:cash:hu|v', r]]);
    HorseMind.runInSandbox(sb, () => {
      HorseMind.setDecisionScope('holdem:hu', 'nlh');
      expect(HorseMind.openerResponseOf('v')).toEqual(r);
      expect(HorseMind.openerResponseOf('w')).toBeNull();
      HorseMind.setDecisionScope('holdem:full', 'nlh');
      expect(HorseMind.openerResponseOf('v')).toBeNull();
      HorseMind.setDecisionScope('omaha:hu', 'plo6');
      expect(HorseMind.openerResponseOf('v')).toBeNull();
    });
  });
});
