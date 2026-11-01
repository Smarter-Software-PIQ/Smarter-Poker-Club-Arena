export const ADDON_TABLE_CAP = 8;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export type AddOnTable = { id: string; status: string; tournament_id: string };
export function admitNaturalAddOn(payload: Record<string, unknown>): string {
  const id = payload.natural_addon_tournament_id;
  if (typeof id !== 'string' || !UUID.test(id))
    throw new Error('UNKNOWN: exact natural add-on tournament UUID required');
  if (typeof payload.engine_sha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.engine_sha))
    throw new Error('UNKNOWN: natural add-on proof requires exact engine SHA');
  for (const mode of [
    'mobile_multirun',
    'mobile_multirun_target',
    'horse_social',
    'client_navigation',
    'keep_game_pages',
  ])
    if (Object.hasOwn(payload, mode))
      throw new Error('Natural add-on proof cannot combine observation modes');
  return id;
}
export function completeAddOnRoster(
  rows: AddOnTable[] | null,
  count: number | null,
  tournamentId: string
): AddOnTable[] {
  if (
    !rows ||
    !Number.isInteger(count) ||
    count! < 1 ||
    count! > ADDON_TABLE_CAP ||
    rows.length !== count
  )
    throw new Error('UNKNOWN: natural add-on roster is empty, incomplete or exceeds eight tables');
  if (
    new Set(rows.map((row) => row.id)).size !== count ||
    rows.some((row) => !UUID.test(row.id) || row.tournament_id !== tournamentId || !row.status)
  )
    throw new Error('UNKNOWN: natural add-on roster identity is invalid');
  return rows;
}
export function addOnWindow(row: Record<string, unknown>) {
  const start = Date.parse(String(row.addon_period_started_at || ''));
  const end = Date.parse(String(row.addon_period_ends_at || ''));
  const cost = Number(row.addon_cost || row.buy_in_amount);
  const chips = Number(row.addon_chips || row.starting_chips);
  if (row.addon_period_triggered !== true || !Number.isFinite(start) || !Number.isFinite(end))
    return null;
  if (end - start !== 60_000) throw new Error('Natural add-on window is not exactly sixty seconds');
  if (![cost, chips].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Natural add-on price/chips are invalid');
  if (
    !Number.isInteger(row.current_level) ||
    !Number.isInteger(row.late_reg_levels) ||
    Number(row.current_level) < Number(row.late_reg_levels)
  )
    throw new Error('Natural add-on opened before the final late-entry level ended');
  return { start, end, cost, chips };
}
export function countdownSeconds(text: string): number {
  const match = /^(\d+):(\d{2})$/.exec(text.trim());
  if (!match || Number(match[2]) > 59)
    throw new Error('UNKNOWN: rendered add-on countdown is unreadable');
  return Number(match[1]) * 60 + Number(match[2]);
}
/** No participation request reaches a real player/table. Auth and read RPCs retain their normal paths. */
export function forbiddenAddOnParticipation(method: string, url: URL): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const path = url.pathname.toLowerCase().replace(/\/+$/, '');
  if (url.hostname === 'engine.smarter.poker') return !path.endsWith('/heartbeat');
  if (
    /\/rest\/v1\/(?:table_seats|tournament_players|wallets|wallet_transactions|chip_ledger|chip_transactions|club_members)$/.test(
      path
    )
  )
    return true;
  const rpc = path.match(/\/rpc\/([^/]+)$/)?.[1];
  // These two STABLE SELECT RPCs run on every served table mount.
  if (rpc === 'fn_db_now' || rpc === 'fn_mystery_bounty_table_state') return false;
  if (rpc)
    return !/^(?:(?:fn_|ca_)?(?:get|read|list|fetch|can|has|is)_|fn_cash_effective_buyin$)/.test(
      rpc
    );
  return /\/(?:action|buyin|buy-in|cashout|cash-out|addchips|rebuy|leave|seat-move|seat-change|register|transfer-chips|mint-chips)$/.test(
    path
  );
}
