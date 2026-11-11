import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HorseDeepDiveCapture,
  horseDeepDiveReceiptIsValid,
  noteHorseDeepDiveRule,
  withHorseDeepDiveCapture,
} from './HorseDeepDiveReceipt.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom, saveFastRandom } from './HorseEval.js';
import { decisionRequest } from '../testing/horseRegression/plan/fixture.js';
import { horseJournalJson } from '../services/horseDecisionJournal/record.js';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import type { HorseDecision } from '../types.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { buildHorseDecisionKey } from './horseDecision/protocol.js';

const fold: HorseDecision = { action: 'fold', thinkTime: 0 };
const frame = 'a'.repeat(64);
beforeEach(() => {
  HorseMind.reset();
  seedFastRandom(10455);
});
afterEach(() => vi.restoreAllMocks());

it('does not turn absent collection, disabled policy or an exception into activation', () => {
  const request = decisionRequest();
  const absent = new HorseDeepDiveCapture(request);
  expect(absent.finish(fold, frame)).toMatchObject({
    status: 'not_reached',
    effectiveEnabled: null,
    rules: [],
  });
  const disabled = new HorseDeepDiveCapture(request);
  withHorseDeepDiveCapture(disabled, false, () => {});
  expect(disabled.finish(fold, frame)).toMatchObject({
    status: 'observed',
    effectiveEnabled: false,
    rules: [],
  });
  const failed = new HorseDeepDiveCapture(request);
  expect(() =>
    withHorseDeepDiveCapture(failed, true, () => {
      throw Error('failed');
    })
  ).toThrow('failed');
  noteHorseDeepDiveRule('priced_in_floor', true, true);
  expect(failed.finish(fold, frame)).toMatchObject({ status: 'refused', rules: [] });
});

it('isolates nested chooser calls and restores the outer capture', () => {
  const outer = new HorseDeepDiveCapture(decisionRequest());
  const inner = new HorseDeepDiveCapture(decisionRequest());
  withHorseDeepDiveCapture(outer, true, () => {
    noteHorseDeepDiveRule('call_floor', true, false);
    withHorseDeepDiveCapture(inner, true, () =>
      noteHorseDeepDiveRule('priced_in_floor', true, true)
    );
    withHorseDeepDiveCapture(undefined, true, () =>
      noteHorseDeepDiveRule('hand_class', true, true)
    );
    noteHorseDeepDiveRule('call_floor', true, true);
  });
  expect(outer.finish(fold, frame).rules).toEqual([
    { rule: 'call_floor', evaluated: 2, eligible: 2, changed: 1 },
  ]);
  expect(inner.finish(fold, frame).rules).toEqual([
    { rule: 'priced_in_floor', evaluated: 1, eligible: 1, changed: 1 },
  ]);
});

it('binds request, read frame and result; refuses malformed counts and unsupported rules', () => {
  const request = decisionRequest();
  const c = new HorseDeepDiveCapture(request);
  withHorseDeepDiveCapture(c, true, () => noteHorseDeepDiveRule('price_relief', true, true));
  const receipt = c.finish(fold, frame);
  expect(horseDeepDiveReceiptIsValid(receipt, request, fold, frame)).toBe(true);
  expect(horseDeepDiveReceiptIsValid(receipt, { ...request, requestId: 101 }, fold, frame)).toBe(
    false
  );
  expect(horseDeepDiveReceiptIsValid(receipt, request, fold, 'b'.repeat(64))).toBe(false);
  expect(
    horseDeepDiveReceiptIsValid(receipt, request, { action: 'call', thinkTime: 0 }, frame)
  ).toBe(false);
  for (const patch of [
    { effectiveEnabled: false },
    { pillar2: 'enabled' },
    { status: 'not_reached' },
    { rules: [{ rule: 'price_relief', evaluated: 1, eligible: 0, changed: 1 }] },
    { rules: [{ rule: 'made_up', evaluated: 1, eligible: 1, changed: 1 }] },
    { rules: [...receipt.rules, ...receipt.rules] },
    { extra: true },
  ])
    expect(horseDeepDiveReceiptIsValid({ ...receipt, ...patch }, request, fold, frame)).toBe(false);
  expect(Buffer.byteLength(horseJournalJson(receipt))).toBeLessThan(4096);
  receipt.rules[0]!.changed = 0;
  expect(c.finish(fold, frame).rules[0]!.changed).toBe(1);
});

it('bounds repeated observations and refuses reuse without changing the callable result', () => {
  const c = new HorseDeepDiveCapture(decisionRequest());
  const result = withHorseDeepDiveCapture(c, true, () => {
    for (let i = 0; i < 40; i++) noteHorseDeepDiveRule('call_floor', true, true);
    return 42;
  });
  expect(result).toBe(42);
  expect(c.finish(fold, frame)).toMatchObject({ status: 'refused', rules: [{ evaluated: 32 }] });
  const reused = new HorseDeepDiveCapture(decisionRequest());
  withHorseDeepDiveCapture(reused, true, () => {});
  withHorseDeepDiveCapture(reused, true, () => {});
  expect(reused.finish(fold, frame).status).toBe('refused');
});

it('captures actual preflop consumers and preserves the PLO8 exclusion', () => {
  const ctx: PreflopCtx = {
    strength: 0.37,
    position: 'bb',
    raiserPosition: 'late',
    raises: 1,
    limpers: 0,
    callers: 3,
    oppsLeft: 4,
    toCall: 5,
    currentBet: 7,
    pot: 24.5,
    bigBlind: 2,
    stack: 200,
    stackBB: 100,
    aggression: 1,
    tightness: 1,
    bluffFreq: 0.12,
    slowplayFreq: 0.08,
    sizingMultiplier: 1,
    isOmaha: true,
    isPotLimit: true,
    riskAdd: 0,
    ploPriceDefense: true,
    mode: 'cash',
    rand: () => 0.5,
    v87DeepDiveDiscipline: true,
    omahaHoleCount: 6,
    omahaHiLo: false,
  };
  const c = new HorseDeepDiveCapture(decisionRequest());
  expect(withHorseDeepDiveCapture(c, true, () => decidePreflopV7(ctx)).a).toBe('fold');
  expect(c.finish(fold, frame).rules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: 'cold_call_bar', eligible: 1, changed: 1 }),
      expect.objectContaining({ rule: 'price_relief', eligible: 1, changed: 1 }),
    ])
  );
  const excluded = new HorseDeepDiveCapture(decisionRequest());
  withHorseDeepDiveCapture(excluded, true, () =>
    decidePreflopV7({ ...ctx, omahaHiLo: true, omahaHoleCount: 4 })
  );
  expect(excluded.finish(fold, frame).rules.every((r) => r.eligible === 0 && r.changed === 0)).toBe(
    true
  );
});

it.each([true, false])(
  'capture preserves the exact decision and RNG with enabled=%s',
  (enabled) => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const request = decisionRequest();
    const opts = { ...request.opts, mind: false, v87DeepDiveDiscipline: enabled };
    const run = (capture?: HorseDeepDiveCapture) => {
      HorseMind.reset();
      seedFastRandom(10455);
      const decision = HorseLogic.decide(
        request.player,
        request.gameState,
        request.style,
        request.mods,
        opts,
        undefined,
        undefined,
        capture
      );
      return { decision, rng: saveFastRandom() };
    };
    const baseline = run();
    HorseMind.reset();
    seedFastRandom(10455);
    const detachedDecide = HorseLogic.decide;
    expect({
      decision: detachedDecide(
        request.player,
        request.gameState,
        request.style,
        request.mods,
        opts
      ),
      rng: saveFastRandom(),
    }).toEqual(baseline);
    const c = new HorseDeepDiveCapture(request);
    expect(run(c)).toEqual(baseline);
    expect(c.finish(baseline.decision, frame)).toMatchObject({
      status: 'observed',
      effectiveEnabled: enabled,
      pillar2: 'excluded_by_qualification',
    });
  }
);

it('records the actual presumed opener and five/six-card class consumers', () => {
  const request = decisionRequest();
  request.player = {
    ...request.player,
    stack: 200,
    bet: 2,
    totalInvested: 2,
    cards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
      { rank: '8', suit: 'clubs' },
    ],
  };
  request.gameState = {
    ...request.gameState,
    gameVariant: 'plo6',
    stage: 'preflop',
    communityCards: [],
    variantRules: horseVariantRulesFor('plo6'),
    bettingStructure: 'pot_limit',
    pot: 10,
    contestablePot: 10,
    currentBet: 7,
    toCall: 5,
    minRaiseTo: 12,
    maxRaiseTo: 22,
    legalActions: ['fold', 'call', 'raise'],
    players: [
      { ...request.player, cards: [] },
      { ...request.gameState.players[1]!, bet: 7, totalInvested: 7, stack: 195 },
    ],
    pots: [{ amount: 10, eligiblePlayers: request.gameState.players.map((p) => p.user_id) }],
    actionHistory: [
      {
        seat: 2,
        userId: request.gameState.players[1]!.user_id,
        stage: 'preflop',
        action: 'raise',
        amount: 7,
        timestamp: 1700009000000,
      },
    ],
  };
  request.opts = {
    mind: true,
    v86PloOverhaul: false,
    v87DeepDiveDiscipline: true,
  };
  request.decisionKey = buildHorseDecisionKey(request);
  const c = new HorseDeepDiveCapture(request);
  const d = HorseLogic.decide(
    request.player,
    request.gameState,
    request.style,
    request.mods,
    { ...request.opts, observeMind: false },
    undefined,
    undefined,
    c
  );
  const receipt = c.finish(d, frame);
  expect(d.policyFallback).toBeUndefined();
  expect(receipt.status).toBe('observed');
  expect(receipt.rules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: 'presumed_opener', eligible: 1, changed: 1 }),
      expect.objectContaining({ rule: 'hand_class', eligible: 1, changed: 1 }),
    ])
  );
  expect(horseDeepDiveReceiptIsValid(receipt, request, d, frame)).toBe(true);
});
