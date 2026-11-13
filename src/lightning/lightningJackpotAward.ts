/** Paid shares belong to the dealt-in recipient, never the room's current roster. */
export function lightningJackpotAward(
  userId: string | null | undefined,
  payout: {
    loser?: { userId?: string; share?: number };
    winner?: { userId?: string; share?: number };
    tablePlayerIds?: string[];
    perPlayerShare?: number;
  }
): number {
  if (!userId) return 0;
  const share =
    userId === payout.loser?.userId
      ? payout.loser.share
      : userId === payout.winner?.userId
        ? payout.winner.share
        : payout.tablePlayerIds?.includes(userId)
          ? payout.perPlayerShare
          : 0;
  return typeof share === 'number' && Number.isFinite(share) && share > 0 ? share : 0;
}
