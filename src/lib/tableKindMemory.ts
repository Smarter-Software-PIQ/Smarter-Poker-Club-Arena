/**
 * A TOURNAMENT TABLE NEVER PAINTS AS A CASH TABLE (Dan 2026-11-02).
 *
 * TablePage's first state used to say `isTournament: false` for every table
 * until its `tables` row loaded. When the page re-mounted after the engine
 * restart at 05:54:50 UTC, the engine snapshot painted the seats before that
 * row returned, so a tournament table rendered for a moment as a cash table:
 * its top seats took the cash `seat-wrapper--top` lane and were shifted by
 * their own art, which is how jam_degen ended up sitting on the felt.
 *
 * A table id never changes kind, so the kind learned from the row is kept per
 * table and seeds the next mount's first paint. Memory first, then
 * sessionStorage so a reload in the same tab keeps it too. Storage can throw
 * (private windows, blocked site data); every access is guarded and a miss
 * simply falls back to the row, exactly as before.
 */
const STORAGE_KEY = 'ca:table-kind:v1';
const MAX_REMEMBERED = 200;
const memory = new Map<string, boolean>();

function readStored(): Record<string, boolean> {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function rememberTableIsTournament(
  tableId: string | undefined | null,
  isTournament: boolean
) {
  if (!tableId) return;
  memory.set(tableId, isTournament);
  try {
    const stored = readStored();
    if (stored[tableId] === isTournament) return;
    stored[tableId] = isTournament;
    const keys = Object.keys(stored);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete stored[key];
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable: the in-memory answer still covers a re-mount.
  }
}

export function knownTableIsTournament(tableId: string | undefined | null): boolean | undefined {
  if (!tableId) return undefined;
  if (memory.has(tableId)) return memory.get(tableId);
  const stored = readStored()[tableId];
  return typeof stored === 'boolean' ? stored : undefined;
}

/** Test seam: forget everything this module remembers. */
export function forgetTableKindsForTest() {
  memory.clear();
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
