/**
 * Test support for omahaRiverBetPriorIsPotTypeSplit (PLO-OWNER lead-9 lane RV2 2026-11-27): the committed real river
 * facing-bet states the people-measured price reads, each also with its public preflop history made a re-raised pot
 * (two more raises that lift the level; nothing else of the state changes), and the engine's own decide.
 */
import type { HorseDecision } from '../types.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';
import { decideTurnLine } from './HorseOmahaTurnLinePeoplePrior.test-support.js';

export const RIVER_POT_BASE = { omahaFacingBetPriorIsPeopleMeasured: true };
export const RIVER_POT_ON = { ...RIVER_POT_BASE, omahaRiverBetPriorIsPotTypeSplit: true };
export const RIVER_POT_RECEIPT = 'omaha_river_pot_prior_read';

export interface RiverPotState extends PricedState {
  /** the pot type of the public preflop history as the option reads it */
  pot: string;
  /** whether the preflop history was rewritten into a re-raised pot */
  rewritten: boolean;
}

type Act = { stage?: unknown; seat?: number; action?: string; amount?: number };

/** The same state with two more preflop raises by the two players still in the hand. */
function asReraised(s: PricedState): PricedState {
  const gs = structuredClone(s.gs);
  const hist = (gs.actionHistory ?? []) as Act[];
  const live = (gs.players ?? []).filter((p) => !p.is_folded).map((p) => p.seat);
  const level = Math.max(2, ...hist.filter((a) => a.stage === 'preflop').map((a) => a.amount ?? 0));
  let at = -1;
  hist.forEach((a, i) => {
    if (a.stage === 'preflop') at = i;
  });
  const [a, b] = [live[0] ?? 1, live[1] ?? live[0] ?? 2];
  hist.splice(
    at + 1,
    0,
    { stage: 'preflop', seat: a, action: 'raise', amount: level * 3 },
    { stage: 'preflop', seat: b, action: 'raise', amount: level * 9 },
    { stage: 'preflop', seat: a, action: 'call', amount: level * 6 }
  );
  (gs as { actionHistory?: unknown }).actionHistory = hist;
  return { ...s, gs };
}

/** Every committed river state, as recorded and (where it is not one already) as a re-raised pot. */
export function riverPotStates(): RiverPotState[] {
  const out: RiverPotState[] = [];
  for (const s of loadPricedStates()) {
    if (s.gs.stage !== 'river') continue;
    const pot = omahaPeoplePriorFlopPotOf(s.gs.actionHistory as never);
    out.push({ ...s, pot, rewritten: false });
    if (pot !== 'reraised') out.push({ ...asReraised(s), pot: 'reraised', rewritten: true });
  }
  return out;
}

/** The engine's own decide on one state (fresh memory, no opponent record). */
export function decideRiverPot(
  s: PricedState,
  opts: Record<string, boolean>,
  telemetry: boolean
): HorseDecision {
  return decideTurnLine(s.player, s.gs, false, telemetry, opts);
}
