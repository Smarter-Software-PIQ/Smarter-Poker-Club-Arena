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
 *
 * The selected run is a live event too: other players register for it while
 * the journey runs (Post-Deploy E2E runs 43771208157 and 43781951342: its
 * Entries went 330 -> 331, 349 -> 350 and 352 -> 353 with every row in
 * place). Its name, price, start and pin must not change; its own entry count
 * may. A peer at the same price whose count lies between the selected run's
 * old and new count can legitimately trade places with it under that order,
 * so such a peer is not compared.
 */
export function sameUnchangedLobbyOrder(
  current: ReadonlyArray<LobbyOrderRow>,
  reference: ReadonlyArray<LobbyOrderRow>,
  chosen: string,
  readAt: number
): boolean {
  const previous = new Map(reference.map((row) => [row.id, row.sortKey]));
  const then = reference.find((row) => row.id === chosen);
  const now = current.find((row) => row.id === chosen);
  if (!then || !now || !(now.start > readAt)) return false;
  const [name0, price0, entries0, start0, pin0] = JSON.parse(then.sortKey);
  const [name1, price1, entries1, start1, pin1] = JSON.parse(now.sortKey);
  if (name0 !== name1 || price0 !== price1 || start0 !== start1 || pin0 !== pin1) return false;
  const moved = String(entries0) !== String(entries1);
  const low = Math.min(Number(entries0), Number(entries1));
  const high = Math.max(Number(entries0), Number(entries1));
  if (moved && !(Number.isFinite(low) && Number.isFinite(high))) return false;
  const tradesPlaces = (row: LobbyOrderRow) => {
    if (!moved) return false;
    const [, price, entries] = JSON.parse(row.sortKey);
    const count = Number(entries);
    return price === price1 && count >= low && count <= high;
  };
  const stable = new Set(
    current
      .filter(
        (row) =>
          row.id === chosen ||
          (previous.get(row.id) === row.sortKey && row.start > readAt && !tradesPlaces(row))
      )
      .map((row) => row.id)
  );
  // Never certify promotion by dropping the selected row or every comparison peer.
  if (stable.size < 2) return false;
  const a = current.filter((row) => stable.has(row.id)).map((row) => row.id);
  const b = reference.filter((row) => stable.has(row.id)).map((row) => row.id);
  return a.join() === b.join();
}
