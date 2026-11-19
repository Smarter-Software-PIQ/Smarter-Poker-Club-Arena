/**
 * A LIGHTNING PLO5 PAIRED-BOARD FOLD THEN FACING-BET EV CALL IS ADMITTED
 * (PLO Strategy lane 2026-11-19; live refusal, journal debcf579..., 2026-11-18
 * 23:00:11Z, LightningHost, PLO5 1/2 pool, turn).
 *
 * The request: board 8s 8h Js 6h (paired), the Horse has 12.8 behind and faces a
 * bet of 9; legal fold, call, all in. The reference shoved (all in). Inside the
 * wager_rules node the PLO paired-board fold turned the shove into a fold and
 * omahaFacingBetEv turned the fold into the call of 9, so the node records
 * all_in -> call. The validator admitted a facing-bet EV call only from a fold,
 * and admitted raise -> call only through the nut-rule and priced-raise
 * admissions, whose scope refuses Lightning: the worker's decision was refused
 * ('policy_graph') and the Horse played a fallback action. The same request at
 * a table was admitted, by the nut-rule admission covering it by accident.
 *
 * Fixture: the recorded request and the decision's own policy graph, with every
 * id replaced and usernames set to p<seat>.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { horseDecisionReceiptRefusal } from './responseValidation.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import type { SeatPlayer } from '../../types.js';

const FX = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'src/engine/horseDecision/fixtures/lightning-plo5-paired-fold-then-ev-call.request.json'
    ),
    'utf8'
  )
) as { player: SeatPlayer; gameState: HorseGameStateV2; decision: Record<string, unknown> };

const at = (speed: 'lightning' | 'table', patch: Partial<HorseGameStateV2> = {}) => ({
  player: structuredClone(FX.player),
  gameState: {
    ...structuredClone(FX.gameState),
    publicMemoryDomain: { version: 1, speed, ante: 'big_blind' },
    ...patch,
  } as HorseGameStateV2,
});
const decision = () => structuredClone(FX.decision);
const graphAfter = (after: { action: string; amount: number | null }) => {
  const d = decision();
  const g = d.policyGraph as {
    transitions: Array<{ node: string; before: unknown; after: unknown; changed: boolean }>;
    finalAction: unknown;
  };
  for (const t of g.transitions) {
    if (t.node === 'wager_rules') t.after = after;
    if (t.node === 'timing') {
      t.before = after;
      t.after = after;
    }
  }
  g.finalAction = after;
  d.action = after.action;
  d.amount = after.amount ?? undefined;
  return d;
};

describe('a Lightning PLO5 paired-board fold then facing-bet EV call', () => {
  it('the recorded request: the shove became the call of 9 inside wager_rules', () => {
    const g = FX.decision.policyGraph as {
      transitions: Array<{ node: string; before: unknown; after: unknown }>;
    };
    const wr = g.transitions.find((t) => t.node === 'wager_rules')!;
    expect(wr.before).toEqual({ action: 'all_in', amount: null });
    expect(wr.after).toEqual({ action: 'call', amount: 9 });
    expect((FX.gameState.publicMemoryDomain as { speed: string }).speed).toBe('lightning');
  });

  it('is admitted in Lightning, as at a table', () => {
    expect(horseDecisionReceiptRefusal(decision(), 'plo5', at('lightning'))).toBeNull();
    expect(horseDecisionReceiptRefusal(decision(), 'plo5', at('table'))).toBeNull();
  });

  it('only for the exact chips of the call', () => {
    const wrong = graphAfter({ action: 'call', amount: 8 });
    expect(horseDecisionReceiptRefusal(wrong, 'plo5', at('lightning'))).toBe('policy_graph');
  });

  it('only where the paired-board fold holds: the same hand on an unpaired board stays refused', () => {
    // 7d 7c Jh 2h (paired) and 7d 3c Jh 2h (one card changed, unpaired): no flush or straight draw for
    // the hand, so no other admission (the draw raise -> call) applies; only the paired-board fold differs.
    const card = (rank: string, suit: string) =>
      ({ rank, suit }) as (typeof FX.gameState.communityCards)[number];
    const paired = [
      card('7', 'diamonds'),
      card('7', 'clubs'),
      card('J', 'hearts'),
      card('2', 'hearts'),
    ];
    const unpaired = [
      card('7', 'diamonds'),
      card('3', 'clubs'),
      card('J', 'hearts'),
      card('2', 'hearts'),
    ];
    expect(
      horseDecisionReceiptRefusal(decision(), 'plo5', at('lightning', { communityCards: paired }))
    ).toBeNull();
    expect(
      horseDecisionReceiptRefusal(decision(), 'plo5', at('lightning', { communityCards: unpaired }))
    ).toBe('policy_graph');
    // (At a table the nut-rule raise -> call admission still covers it, unchanged by this fix.)
  });

  it('never without the request', () => {
    expect(horseDecisionReceiptRefusal(decision(), 'plo5')).toBe('policy_graph');
  });
});
