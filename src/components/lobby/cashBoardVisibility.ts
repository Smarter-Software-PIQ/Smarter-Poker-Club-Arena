import { isFixedLimitVariant } from '../../lib/bettingStructure';
import { cashEntry, type LobbyTableRow } from './lobbyEntries';

/** OWNER ORDER 2026-11-05 (Dan): "1/2 PLO AND 1/2 NO LIMIT SHOULD STILL SHOW
 * 'EMPTY TABLES' EVEN IF NO HORSES ARE PLAYING, DO NOT REMOVE THEM ALL
 * TOGETHER ... IF A HUMAN PLAYER WANTS TO PLAY THEM, THEY NEED TO BE
 * 'AVAILABLE TO SIT DOWN AND PLAY'". The November 2 hide-empty default still
 * governs every other game. This changes only what the lobby SHOWS: the horse
 * union cash schedule (server/src/services/horseUnionCashPlan.json) still
 * decides when horses sit in these games, and is untouched.
 */
const ALWAYS_SHOWN_VARIANTS = new Set(['nlh', 'plo', 'plo4', 'plo5', 'plo6']);
export function alwaysShownEmptyCashGame(
  table: Pick<LobbyTableRow, 'game_variant' | 'small_blind' | 'big_blind'>
): boolean {
  return (
    ALWAYS_SHOWN_VARIANTS.has(String(table.game_variant ?? '').toLowerCase()) &&
    Number(table.small_blind) === 1 &&
    Number(table.big_blind) === 2
  );
}

/** One visibility rule before any cash filter, saved preference or linked row. */
export function cashBoardVisible(table: LobbyTableRow, showEmptyTables = false): boolean {
  if (table.is_deleted === true || table.lifecycle === 'closed') return false;
  if (!['waiting', 'running', 'active'].includes(String(table.status).toLowerCase())) return false;
  const entry = cashEntry(table);
  if (entry.status === 'closed' || entry.status === 'completed') return false;
  // Use the card's game-wide/Lightning figure, never just its front table.
  return showEmptyTables || Number(entry.players) > 0 || alwaysShownEmptyCashGame(table);
}

/** Fixed limit is opt-in on All; choosing Limit is itself an explicit opt-in. */
export function cashVariantVisible(
  variant: string | null | undefined,
  category: string,
  includeFixedLimit = false
): boolean {
  return category !== 'ALL' || includeFixedLimit || !isFixedLimitVariant(variant);
}
