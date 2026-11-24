/**
 * A PRICED OPTION DECLARES A SHADOW STAGE ENTRY OR STATES WHY IT CANNOT BE STAGED (2026-11-24, PLO-OWNER lead-6,
 * HOLD'EM SHADOW; HorseOptionShadowStage.optionShadowStageRegistrationGaps).
 *
 * Without a stage entry a new priced option in shadow is re-decided before the answer under the 15 ms budget, with
 * no breaker and no per-game time, or goes from offline replay straight to acting on real chips. So every registered
 * option whose name says it is priced (/pric/i) and that takes shadow or on_shadow is either listed in
 * OPTION_SHADOW_STAGE (one line, e.g. `holdemStage(['nlh_cash', 'nlh_lightning'], ['river'])`) or in
 * OPTION_SHADOW_STAGE_UNSTAGED with its reason; never both, never an empty reason, never a stale name.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_SHADOW_STAGE,
  OPTION_SHADOW_STAGE_UNSTAGED,
  holdemStage,
  optionShadowStageRegistrationGaps,
} from './HorseOptionShadowStage.js';
import { OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';

describe('a priced option declares a shadow stage entry or states why it cannot be staged', () => {
  it('holds for every option the registry holds today', () => {
    expect(optionShadowStageRegistrationGaps(OPTION_SWITCH_REGISTRY)).toEqual([]);
  });

  it('a new priced option that takes shadow, with neither an entry nor a reason, fails the law', () => {
    const registry = [
      ...OPTION_SWITCH_REGISTRY,
      { name: 'holdemSomethingNewIsPriced', states: ['off', 'shadow', 'on_shadow', 'on'] },
    ];
    expect(optionShadowStageRegistrationGaps(registry)).toEqual([
      'holdemSomethingNewIsPriced: a priced option declares a shadow stage entry or states why it cannot be staged',
    ]);
    // one line of registration makes it pass
    const table = {
      ...OPTION_SHADOW_STAGE,
      holdemSomethingNewIsPriced: holdemStage(['nlh_cash'], ['river']),
    };
    expect(optionShadowStageRegistrationGaps(registry, table)).toEqual([]);
    // or a stated reason
    expect(
      optionShadowStageRegistrationGaps(registry, OPTION_SHADOW_STAGE, {
        ...OPTION_SHADOW_STAGE_UNSTAGED,
        holdemSomethingNewIsPriced: 'acts in every game',
      })
    ).toEqual([]);
  });

  it('an off-only priced option needs nothing (it can never be in shadow)', () => {
    const registry = [...OPTION_SWITCH_REGISTRY, { name: 'holdemHeldIsPriced', states: ['off'] }];
    expect(optionShadowStageRegistrationGaps(registry)).toEqual([]);
  });

  it('refuses both lists at once, an empty reason, a stale reason, and an entry with no or an unknown game', () => {
    const registry = [
      { name: 'aIsPriced', states: ['off', 'shadow'] },
      { name: 'bIsPriced', states: ['off', 'shadow'] },
      { name: 'cIsPriced', states: ['off'] },
    ];
    const gaps = optionShadowStageRegistrationGaps(
      registry,
      { aIsPriced: holdemStage(['nlh_cash']), x: { games: [] }, y: { games: ['plo6' as never] } },
      { aIsPriced: 'why', bIsPriced: ' ', cIsPriced: 'why', gone: 'why' }
    );
    expect(gaps).toEqual([
      'aIsPriced: both staged and listed as not staged',
      'bIsPriced: the reason it cannot be staged is empty',
      'cIsPriced: listed as not staged but takes neither shadow nor on_shadow',
      'gone: listed as not staged but not registered',
      'x: a stage entry lists no game',
      'y: unknown stage game plo6',
    ]);
  });

  it('the hold-em options meant to be trialled are staged, not merely excused', () => {
    for (const name of [
      'holdemValueAndCallsArePriced',
      'holdemTournamentAllInCallIsPriced',
      'cashDefenceTrimColdCalls',
    ]) {
      expect(Object.hasOwn(OPTION_SHADOW_STAGE, name), name).toBe(true);
      expect(Object.hasOwn(OPTION_SHADOW_STAGE_UNSTAGED, name), name).toBe(false);
    }
  });
});
