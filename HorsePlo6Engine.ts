/**
 * HorsePlo6Engine: centralized PLO6 strategy and evaluation engine.
 * Facade class that delegates to existing PLO6 implementation files.
 * 
 * // fast-table cash
 */

import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { plo6CountHoldingsAmong, plo6FastCountCalls } from './HorsePlo6FastCount.js';
import { plo6NoMultiwayBetWithWeakMadeHand } from './HorsePlo6MultiwayWeakBet.js';

export class HorsePlo6Engine {
  constructor() {}

  public computeFastCount(
    n: number,
    barLo: Int32Array,
    barHi: Int32Array,
    allLo: number,
    allHi: number
  ): number {
    return plo6CountHoldingsAmong(n, barLo, barHi, allLo, allHi);
  }

  public plo6FastCountCalls(): number {
    return plo6FastCountCalls();
  }

  public evaluateMultiwayBet(
    decision: HorseDecision,
    hero: SeatPlayer,
    gs: HorseGameStateV2
  ): any {
    return plo6NoMultiwayBetWithWeakMadeHand(decision, hero, gs);
  }
}
