import { isFixedLimitVariant } from '../../lib/bettingStructure';
import { cashEntry, type LobbyTableRow } from './lobbyEntries';

/** One visibility rule before any cash filter, saved preference or linked row. */
export function cashBoardVisible(table: LobbyTableRow, showEmptyTables = false): boolean {
  if (table.is_deleted === true || table.lifecycle === 'closed') return false;
  if (!['waiting', 'running', 'active'].includes(String(table.status).toLowerCase())) return false;
  const entry = cashEntry(table);
  if (entry.status === 'closed' || entry.status === 'completed') return false;
  // Use the card's game-wide/Lightning figure, never just its front table.
  return showEmptyTables || Number(entry.players) > 0;
}

/** Fixed limit is opt-in on All; choosing Limit is itself an explicit opt-in. */
export function cashVariantVisible(
  variant: string | null | undefined,
  category: string,
  includeFixedLimit = false
): boolean {
  return category !== 'ALL' || includeFixedLimit || !isFixedLimitVariant(variant);
}
