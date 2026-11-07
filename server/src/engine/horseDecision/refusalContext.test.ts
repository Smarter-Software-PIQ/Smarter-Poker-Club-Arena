import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jointPolicyFixture } from '../multiway/JointRangeFixture.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { buildHorseDecisionKey, type FastHorseDecisionRequest } from './protocol.js';
import { horseLifecycleKeys } from '../../services/horseDecisionJournal/lifecycle.js';
import { journalHash } from '../../services/horseDecisionJournal/record.js';
import {
  horseDecisionRefusalContext,
  horseDecisionRefusalContextOf,
  horseDecisionRefusalError,
} from './refusalContext.js';
import type { HorseDecision } from '../../types.js';

/*
 * A REFUSED DECISION CARRIES ITS JOURNAL KEY AND ITS SHAPE (2026-11-07).
 * One reference_shape refusal (Lightning NLH 0.25/0.50, hand cc8a59bb) could
 * not be joined to its journal record: the journal keys a hand by
 * sha256(tableId:handNumber:leaseIdentity) and the lease is not in the
 * database. The refusal now carries the exact hashed keys.
 */

const TABLE = '10000000-0000-4000-8000-000000000001';
const LEASE = '30000000-0000-4000-8000-000000000009';

function request(fence = `${TABLE}:12:1:${LEASE}:7`): FastHorseDecisionRequest {
  const { hero, state } = JSON.parse(
    JSON.stringify(jointPolicyFixture('nlh', 1, 'cash', 'preflop')),
    (_key, v) =>
      typeof v === 'string' && /^p[0-9]$/.test(v)
        ? `20000000-0000-4000-8000-00000000000${Number(v.slice(1)) + 1}`
        : v
  );
  const r: FastHorseDecisionRequest = {
    type: 'DECIDE_FAST',
    requestId: 3,
    generation: 7,
    fence,
    decisionTimeMs: 1000,
    decisionKey: '',
    player: hero,
    gameState: state,
    handJournalContext: captureHorseHandJournalContext(state.actionHistory),
  };
  r.decisionKey = buildHorseDecisionKey(r);
  return r;
}

describe('refusal context', () => {
  it('carries the exact hashed hand and turn keys the journal stores', () => {
    const r = request();
    const context = horseDecisionRefusalContext('reference_shape', r);
    const keys = horseLifecycleKeys(r);
    // The hand key is sha256 of tableId:handNumber:leaseIdentity.
    expect(keys.hand).toBe(`${TABLE}:12:${LEASE}`);
    expect(context).toEqual({
      version: 1,
      reason: 'reference_shape',
      journalHandKey: createHash('sha256').update(`${TABLE}:12:${LEASE}`).digest('hex'),
      journalTurnKey: journalHash(keys.turn),
      journalKeyStatus: 'available',
      requestType: 'DECIDE_FAST',
    });
  });

  it('says unavailable rather than guessing when the fence carries no lease', () => {
    const r = request(`${TABLE}:12:1`);
    r.decisionKey = buildHorseDecisionKey(r);
    expect(horseDecisionRefusalContext('route_gate', r)).toMatchObject({
      journalHandKey: null,
      journalTurnKey: null,
      journalKeyStatus: 'unavailable',
    });
  });

  it('keeps the message line the existing log parser matches, and is bounded', () => {
    const r = request();
    const error = horseDecisionRefusalError('reference_shape', r);
    expect(error).toBeInstanceOf(Error);
    expect(error.constructor).toBe(Error);
    expect(error.name).toBe('Error');
    expect(error.message).toBe(
      'horse decision worker returned invalid policy receipt: reference_shape'
    );
    expect(String(error.stack).split('\n')[0]).toBe(`Error: ${error.message}`);
    expect(horseDecisionRefusalContextOf(error)).toBe(error.refusal);
    expect(horseDecisionRefusalContextOf(new Error('x'))).toBeNull();
    expect(horseDecisionRefusalContext('not a name: x', r).reason).toBe('unnamed');
  });

  it('adds the public Phase 6 shape only for a Phase 6 refusal, without private data', () => {
    const r = request();
    const decision: HorseDecision = {
      action: 'call',
      amount: 1,
      thinkTime: 0,
      tournamentPreflopAttribution: {
        route: 'variant_price',
        referenceProposal: { action: 'call', amount: 1 },
      } as never,
    };
    expect(horseDecisionRefusalContext('receipt_invalid', r, decision, false)).not.toHaveProperty(
      'route'
    );
    const context = horseDecisionRefusalContext('reference_shape', r, decision, true);
    expect(context).toMatchObject({ route: 'variant_price', action: 'call', amount: 1 });
    expect(Object.keys(context).length).toBeLessThanOrEqual(32);
    for (const v of Object.values(context))
      expect(v === null || ['number', 'string', 'boolean'].includes(typeof v)).toBe(true);
    const json = JSON.stringify(context);
    for (const card of r.player.cards ?? [])
      expect(json).not.toContain(JSON.stringify(card).slice(1, -1));
    for (const p of r.gameState.players) expect(json).not.toContain(p.user_id);
  });
});
