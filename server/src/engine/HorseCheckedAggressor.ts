/** Pure public-action fact for the initiative gate. No policy option or RNG.
 * Historical layer-isolation corpora may mock this module; production always
 * reads the real prior aggressor and current-street check. */
import type { ActionRecord, HandStage } from '../types.js';

const STAGE_ORDER: Record<string, number> = {
  preflop: 0,
  pineapple_discard: 1,
  flop: 1,
  turn: 2,
  river: 3,
};

function priorStreetAggressor(
  history: ActionRecord[] | undefined,
  stage: HandStage
): ActionRecord | null {
  if (!history || history.length === 0) return null;
  const cur = STAGE_ORDER[stage] ?? 1;
  let last: ActionRecord | null = null;
  for (const a of history) {
    if ((STAGE_ORDER[a.stage] ?? 0) >= cur) continue; // earlier streets only
    if (
      a.action === 'bet' ||
      a.action === 'raise' ||
      (a.action === 'all_in' && a.isFullRaise === true)
    ) {
      last = a;
    }
  }
  return last;
}

/** A multiway player can be checked to by the aggressor without acting last.
 * Another opponent's check does not release the initiative gate. */
export function priorAggressorCheckedThisStreet(
  history: ActionRecord[] | undefined,
  stage: HandStage
): boolean {
  const aggressor = priorStreetAggressor(history, stage);
  return (
    !!aggressor &&
    !!history?.some(
      (a) => a.stage === stage && a.userId === aggressor.userId && a.action === 'check'
    )
  );
}
