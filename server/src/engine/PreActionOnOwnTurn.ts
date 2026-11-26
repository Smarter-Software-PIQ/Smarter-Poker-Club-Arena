/**
 * ═══ AN ARM THAT ARRIVES ON YOUR OWN TURN IS AN ACTION, AND MUST HAVE SEEN IT ═══
 *
 * Dan 2026-11-24 (CoachTim68, Breakfast Turbo 425c3668, hand 67a4924c): a late
 * registrant sat down with 5,000, was dealt 5-3 offsuit under the gun plus one,
 * "folded", and was told he was out. The engine recorded his seat as
 * `all_in 5000 [pre_action]`, 19 seconds into his turn, against a 9,450 shove
 * from the seat before him. His phone had reported "Table Display Fell Behind
 * The Engine" twice; his later Fold through /action was correctly refused as
 * STALE_ACTION, because the pre-action had already put his stack in.
 *
 * WHY. A pre-action armed while it is ALREADY the player's turn is executed at
 * once (the 2026-08-15 fix: an arm that lands as the turn begins must not wait
 * for the next turn). /action refuses any decision whose `actionContext` is not
 * the engine's current one; this door asked for nothing. A browser that is
 * behind still shows the pre-action bar (it does not know the turn is his) at a
 * price that no longer exists, and an arm from that bar became an immediate
 * call of a shove the player never saw. Call Any is uncapped by design, so the
 * whole stack went in.
 *
 * THE RULE. On the player's own turn, an arm that can put chips in (Call, Call
 * Any) executes only when it names the decision it was made against, and that
 * decision is the one on the table now. Otherwise nothing is armed and the
 * player is told the action changed, exactly as /action says it. Fold-family
 * and Check arms never commit chips, so they keep acting at once without one
 * (an older browser sends no context; folding or checking for it is what it
 * asked for in every state of the table).
 */

const ARMS_THAT_COMMIT_CHIPS = new Set(['auto_call', 'auto_call_any']);

export interface StaleOwnTurnArm {
  success: false;
  error: string;
  code: 'STALE_ACTION';
}

/** The same sentence /action gives for a decision that has moved on. */
export const STALE_OWN_TURN_ARM: StaleOwnTurnArm = {
  success: false,
  error: 'The turn has changed. Review the table before acting again.',
  code: 'STALE_ACTION',
};

/**
 * `null` when the arm may act now; the refusal when it may not.
 * Call ONLY when the arming player is the seat on turn and can act.
 */
export function ownTurnArmRefusal(
  action: string,
  seenActionContext: unknown,
  currentActionContext: string | null
): StaleOwnTurnArm | null {
  if (!ARMS_THAT_COMMIT_CHIPS.has(action)) return null;
  if (
    typeof seenActionContext === 'string' &&
    seenActionContext.length > 0 &&
    currentActionContext !== null &&
    seenActionContext === currentActionContext
  ) {
    return null;
  }
  return STALE_OWN_TURN_ARM;
}
