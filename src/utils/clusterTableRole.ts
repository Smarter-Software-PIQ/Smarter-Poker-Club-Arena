/**
 * A TABLE'S PLACE IN ITS GAME IS DATA, NEVER ITS NAME (2026-11-19).
 *
 * A must-move Cluster is one `cash_games` row (`tables.cluster_id`) dealt on
 * several `tables` rows, and each row records its own place in it:
 *
 *   tables.role        'main' | 'feeder'  (CHECK tables_role_check); NULL on
 *                      every table that belongs to no Cluster
 *   tables.main_index  1, 2, ... on a main (CHECK main_index >= 1)
 *   cash_games.cluster_mode / lightning_enabled  the Cluster's mode (Lightning)
 *
 * The cluster tick plans every must-move onto `role = 'main'`, and the lobby
 * (`lobbyTableLabel`, `fn_cash_cluster_front_table`) reads the same columns.
 * A table's NAME is display text: Main 1 has always worn the bare game name
 * ("NLH 0.50/1 Classic"), and at 02:37 UTC on 2026-11-19 the generated names
 * changed again, which silently broke every reader that matched /\bmain\b/
 * against a name. Nothing classifies a table from its name; read the role.
 */
export type ClusterTableRole = 'main' | 'feeder';

/** The `tables` columns a reader selects to know a table's place in its game. */
export const CLUSTER_TABLE_ROLE_COLUMNS = 'cluster_id,role,main_index' as const;

/** The seat-move announcement's destination read: what it names, and what it is. */
export const SEAT_MOVE_DESTINATION_COLUMNS = 'name,role' as const;

/** The recorded role of a table row, or null for a table outside any Cluster. */
export function clusterTableRole(
  row: { role?: unknown } | null | undefined
): ClusterTableRole | null {
  const role = row?.role;
  return role === 'main' || role === 'feeder' ? role : null;
}

/** Is this table one of its game's mains (Main 1, Main 2, ...)? */
export function isMainTable(row: { role?: unknown } | null | undefined): boolean {
  return clusterTableRole(row) === 'main';
}

/** Is this table one of its game's feeders? */
export function isFeederTable(row: { role?: unknown } | null | undefined): boolean {
  return clusterTableRole(row) === 'feeder';
}

export const MAIN_GAME_DESTINATION = 'The Main Game';
export const UNKNOWN_DESTINATION = 'Another Table';

/**
 * Where a committed seat move landed, in the words the source table reads.
 *
 * A main is "The Main Game" whatever it is called. Any other table is named.
 * Only when the destination row could not be read, or carries no role, does
 * the move's reason decide: the tick plans a must-move onto a main and nothing
 * else, so an unread must-move destination is still the main game.
 */
export function seatMoveDestinationLabel(
  reason: unknown,
  table: { name?: unknown; role?: unknown } | null | undefined
): string {
  const role = clusterTableRole(table);
  if (role === 'main') return MAIN_GAME_DESTINATION;
  const name = typeof table?.name === 'string' ? table.name.trim() : '';
  if (role === null && reason === 'must_move') return MAIN_GAME_DESTINATION;
  return name || UNKNOWN_DESTINATION;
}
