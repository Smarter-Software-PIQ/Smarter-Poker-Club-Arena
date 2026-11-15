type LobbyOrderRow = { id: string | null; sortKey: string; start: number };

/**
 * Compare favorite causality without freezing the live catalog's sort inputs.
 *
 * Comparison peers are only tournaments that have not started at `readAt`, the
 * moment `current` was read. The board orders tournaments by buy-in, then
 * current_players, then name, and the row's rendered Entries cell (part of
 * `sortKey`) is the entry count. Before a tournament starts those move
 * together, so an unchanged rendered key means an unchanged sort input. Once it
 * runs, a bust moves current_players and not the displayed entries, so two
 * running peers can legitimately swap with byte-identical rendered keys
 * (Post-Deploy E2E run 43668583397, webkit-footer). Such rows prove nothing
 * about the favorite and are not compared. `start` is part of `sortKey`, so a
 * peer not started at `readAt` was not started at the earlier reference read.
 */
export function sameUnchangedLobbyOrder(
  current: ReadonlyArray<LobbyOrderRow>,
  reference: ReadonlyArray<LobbyOrderRow>,
  chosen: string,
  readAt: number
): boolean {
  const previous = new Map(reference.map((row) => [row.id, row.sortKey]));
  const stable = new Set(
    current
      .filter((row) => previous.get(row.id) === row.sortKey && row.start > readAt)
      .map((row) => row.id)
  );
  // Never certify promotion by dropping the selected row or every comparison peer.
  if (!stable.has(chosen) || stable.size < 2) return false;
  const a = current.filter((row) => stable.has(row.id)).map((row) => row.id);
  const b = reference.filter((row) => stable.has(row.id)).map((row) => row.id);
  return a.join() === b.join();
}
