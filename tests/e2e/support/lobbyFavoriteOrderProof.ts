/** Compare favorite causality without freezing the live catalog's sort inputs. */
export function sameUnchangedLobbyOrder(
  current: ReadonlyArray<{ id: string | null; sortKey: string }>,
  reference: ReadonlyArray<{ id: string | null; sortKey: string }>,
  chosen: string
): boolean {
  const previous = new Map(reference.map((row) => [row.id, row.sortKey]));
  const stable = new Set(
    current.filter((row) => previous.get(row.id) === row.sortKey).map((row) => row.id)
  );
  // Never certify promotion by dropping the selected row or every comparison peer.
  if (!stable.has(chosen) || stable.size < 2) return false;
  const a = current.filter((row) => stable.has(row.id)).map((row) => row.id);
  const b = reference.filter((row) => stable.has(row.id)).map((row) => row.id);
  return a.join() === b.join();
}
