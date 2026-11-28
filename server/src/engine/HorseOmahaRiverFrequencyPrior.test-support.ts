/**
 * Test support for omahaRiverBetPriorReadsHisFrequency (PLO-OWNER lead-9 lane RFQ 2026-11-27): the committed real river
 * facing-bet states the people-measured price reads, the engine's own decide, and a lifetime street record that
 * serves the bettor a stated heads-up river first-bet record (the same seam OPPONENT-HUD serves live).
 */
import type { HorseDecision } from '../types.js';
import { HorseMind } from './HorseMind.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';
import { decideTurnLine } from './HorseOmahaTurnLinePeoplePrior.test-support.js';

export const RIVER_FREQ_BASE = { omahaFacingBetPriorIsPeopleMeasured: true };
export const RIVER_FREQ_ON = { ...RIVER_FREQ_BASE, omahaRiverBetPriorReadsHisFrequency: true };
export const RIVER_FREQ_RECEIPT = 'omaha_river_frequency_prior_read';
export const RIVER_FREQ_CALLED = 'omaha_river_frequency_prior_called';

export interface RiverFreqState extends PricedState {
  pot: string;
}

/** Every committed river state with its pot type. */
export function riverFreqStates(): RiverFreqState[] {
  return loadPricedStates()
    .filter((s) => s.gs.stage === 'river')
    .map((s) => ({ ...s, pot: omahaPeoplePriorFlopPotOf(s.gs.actionHistory as never) }));
}

/** The engine's own decide with every opponent's heads-up river record set to `record` (null: no record). */
export function decideRiverFreq(
  s: PricedState,
  opts: Record<string, boolean>,
  telemetry: boolean,
  record: { bets: number; opps: number } | null
): HorseDecision {
  HorseMind.setOmahaLifetimeStreetRecordProvider({
    unopenedWagerRecord: (_u, _g, street, players) =>
      record && street === 'river' && players === 'hu' ? { ...record } : null,
  });
  try {
    return decideTurnLine(s.player, s.gs, false, telemetry, opts);
  } finally {
    HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  }
}
