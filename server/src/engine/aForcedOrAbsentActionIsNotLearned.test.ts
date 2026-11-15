/**
 * FORCED-ACTION COUNTING (2026-11-15, Hold'em Strategy lane, opponent classifier C1; audit F section 3).
 *
 * A forced or absent action is not a choice: it must count as neither a voluntary fold, a participation
 * opportunity nor a raise opportunity, in every learner that reads the public action log.
 *
 * - A player who leaves while not on turn has his queued fold executed by the engine. It was recorded with origin
 *   'pre_action', which every learner counts as his own fold. It is now recorded 'forced'
 *   (ServerTableEngineTurns, pinned in LeaveMeansNow.behaviour.test.ts); here: what the learners do with it.
 * - Lightning timeouts are recorded 'forced' since f24da6f1 (LightningHandHost.timeoutAct); not duplicated here.
 *   What remained on the learner side: the style read's per-street raise tallies (postflopAggressionIncrements)
 *   skipped only 'forced', so a timed-out ('unknown'), fallback or unattributed fold facing a wager still counted as
 *   a raise opportunity with no raise, pushing the street-raise LOW side (#4 / #4b). They now use the exploit
 *   counters' own rule (learnablePublicAction).
 */
import { describe, expect, it } from 'vitest';
import { exploitHandIncrements, learnablePublicAction } from './HorseOpponentExploit.js';
import { postflopAggressionIncrements } from './HorseOpponentStyle.js';

const P = 'player-under-test';
const V = 'villain';

const facingFold = (origin: string | undefined) => [
  { userId: P, action: 'call', amount: 2, stage: 'preflop', origin: 'player' },
  { userId: V, action: 'check', amount: 0, stage: 'preflop', origin: 'player' },
  { userId: V, action: 'bet', amount: 4, stage: 'flop', origin: 'player' },
  { userId: P, action: 'fold', amount: 0, stage: 'flop', ...(origin ? { origin } : {}) },
];

describe('a forced or absent action is not learned', () => {
  it('a leaver engine fold (forced) is not a fold, a fold-to-bet opportunity or a raise opportunity', () => {
    const exploit = exploitHandIncrements(facingFold('forced') as never).get(P)!;
    expect(exploit.foldToBetOpp).toBe(0);
    expect(exploit.foldToBet).toBe(0);
    expect(postflopAggressionIncrements(facingFold('forced')).get(P)?.flop.raiseOpps ?? 0).toBe(0);
  });

  it('a leaver who never acted voluntarily before leaving contributes no hand (no participation opportunity)', () => {
    const acts = [
      {
        userId: V,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        origin: 'player',
        isFullRaise: true,
      },
      { userId: P, action: 'fold', amount: 0, stage: 'preflop', origin: 'forced' },
    ];
    expect(exploitHandIncrements(acts as never).has(P)).toBe(false);
    // the same fold chosen by the player is a counted VPIP-0 hand
    const chosen = acts.map((a) => (a.userId === P ? { ...a, origin: 'pre_action' } : a));
    expect(exploitHandIncrements(chosen as never).get(P)).toMatchObject({ hands: 1, vpip: 0 });
  });

  for (const origin of ['unknown', 'horse_fallback', undefined]) {
    it(`a ${origin ?? 'missing'}-origin fold facing a wager is not a street raise opportunity`, () => {
      expect(postflopAggressionIncrements(facingFold(origin)).get(P)?.flop.raiseOpps ?? 0).toBe(0);
      expect(exploitHandIncrements(facingFold(origin) as never).get(P)!.foldToBetOpp).toBe(0);
    });
  }

  for (const origin of ['player', 'pre_action', 'horse_policy']) {
    it(`a ${origin} fold facing a wager is one raise opportunity and one fold-to-bet opportunity`, () => {
      expect(postflopAggressionIncrements(facingFold(origin)).get(P)!.flop.raiseOpps).toBe(1);
      expect(exploitHandIncrements(facingFold(origin) as never).get(P)!.foldToBetOpp).toBe(1);
    });
  }

  it('the style tallies and the exploit counters admit exactly the same actions', () => {
    const actions = ['fold', 'check', 'call', 'bet', 'raise', 'all_in'];
    const origins = [
      'player',
      'pre_action',
      'horse_policy',
      'horse_fallback',
      'forced',
      'unknown',
      undefined,
    ];
    for (const action of actions)
      for (const origin of origins) {
        const a = { userId: P, action, amount: 0, stage: 'turn', ...(origin ? { origin } : {}) };
        const learned = learnablePublicAction(a);
        const facing = [
          { userId: V, action: 'bet', amount: 4, stage: 'turn', origin: 'player' },
          a,
        ];
        const counted = postflopAggressionIncrements(facing).has(P);
        expect(counted, `${action} / ${origin}`).toBe(learned);
      }
  });
});
