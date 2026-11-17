export interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function countdownPlacementError(
  pill: ScreenRect,
  felt: ScreenRect,
  hand: ScreenRect,
  heroPanels: ScreenRect[]
): string | null {
  if ([pill, felt, hand, ...heroPanels].some((r) => !(r.right > r.left && r.bottom > r.top))) {
    return 'Missing rendered bounds';
  }
  // The artwork's playable surface is a stadium. A bounding rectangle alone
  // would count the four corners outside the curved rail as felt.
  const radius = Math.min(felt.right - felt.left, felt.bottom - felt.top) / 2;
  for (const x of [pill.left, pill.right]) {
    for (const y of [pill.top, pill.bottom]) {
      const dx = Math.max(felt.left + radius - x, 0, x - (felt.right - radius));
      const dy = Math.max(felt.top + radius - y, 0, y - (felt.bottom - radius));
      if (Math.hypot(dx, dy) > radius + 0.5) return 'Countdown extends outside the felt';
    }
  }
  const handCenter = (hand.left + hand.right) / 2;
  if (pill.top + 0.5 < hand.bottom || pill.left > handCenter || pill.right < handCenter) {
    return 'Countdown is displaced from beneath the hand number';
  }
  for (const panel of heroPanels) {
    if (
      pill.left < panel.right &&
      pill.right > panel.left &&
      pill.top < panel.bottom &&
      pill.bottom > panel.top
    ) {
      return 'Countdown overlaps the hero panel';
    }
  }
  return null;
}
