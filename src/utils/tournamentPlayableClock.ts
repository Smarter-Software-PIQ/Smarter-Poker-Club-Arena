/** Match the engine's final duration bounds for a playable level above 25 chips. */
export function playableLevelSeconds(seconds: number, buyIn: unknown, isBreak: unknown): number {
  const amount = Number(buyIn);
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 25 ||
    isBreak === true
  ) {
    return seconds;
  }
  return Math.min(600, Math.max(420, seconds));
}
