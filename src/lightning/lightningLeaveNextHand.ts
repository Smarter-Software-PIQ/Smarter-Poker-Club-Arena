/**
 * LIGHTNING "LEAVE NEXT HAND" (Dan 2026-11-12): "WHEN YOU CLICK 'LEAVE NEXT
 * HAND' ... IT MEANS AFTER THE END OF THE CURRENT HAND, YOU LEAVE THE TABLE.
 * NOT AT THAT EXACT MOMENT."
 *
 * True while the leave must wait: the player is still live in the hand in
 * front of them. The hand is over for them once it settles, once they fold,
 * or once the room itself has closed; then the leave runs.
 */
export function lightningLeaveWaitsForHand(input: {
  inLightningRoom: boolean;
  roomClosed: boolean;
  handInProgress: boolean;
  handSettling: boolean;
  heroStatus: string | null | undefined;
}): boolean {
  return (
    input.inLightningRoom &&
    !input.roomClosed &&
    input.handInProgress &&
    !input.handSettling &&
    !!input.heroStatus &&
    input.heroStatus !== 'folded'
  );
}
