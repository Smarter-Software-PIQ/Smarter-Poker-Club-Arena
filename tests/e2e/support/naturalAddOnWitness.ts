import type { Locator } from '@playwright/test';

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
  if (!rows || !Number.isInteger(count) || count! < 1 || rows.length !== count)
    throw new Error('UNKNOWN: natural add-on roster is empty or incomplete');
  if (
    new Set(rows.map((row) => row.id)).size !== count ||
    rows.some((row) => !UUID.test(row.id) || row.tournament_id !== tournamentId || !row.status)
  )
    throw new Error('UNKNOWN: natural add-on roster identity is invalid');
  // Retain and validate the complete historical roster before selecting live
  // consumers. A retired table has no snapshot or add-on dialog to observe.
  const live = rows.filter((row) => row.status !== 'closed');
  if (live.length === 0 || live.length > ADDON_TABLE_CAP)
    throw new Error('UNKNOWN: natural add-on live roster is empty or exceeds eight tables');
  return live;
}
/** Only before opening: retire departed consumers before admitting new ones.
 * The caller keeps its original observation deadline; readiness is renewed
 * only after every changed-roster subscription supplies its real snapshot. */
export async function synchronizeAddOnObservers(
  currentIds: readonly string[],
  nextIds: readonly string[],
  readyAt: number,
  operations: { open: (id: string) => Promise<unknown>; close: (id: string) => Promise<unknown> },
  now: () => number = Date.now
): Promise<{ ids: string[]; readyAt: number }> {
  const ids = [...nextIds].sort();
  if (!ids.length || ids.length > ADDON_TABLE_CAP || new Set(ids).size !== ids.length)
    throw new Error('UNKNOWN: invalid bounded live observer roster');
  const removed = currentIds.filter((id) => !ids.includes(id));
  const added = ids.filter((id) => !currentIds.includes(id));
  await Promise.all(removed.map((id) => operations.close(id)));
  await Promise.all(added.map((id) => operations.open(id)));
  return { ids, readyAt: removed.length || added.length ? now() : readyAt };
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
/** Capture the rendered value and its clock in the same browser task. A slow
 * protocol response must not age the text before we compare its deadline. */
export async function readAddOnCountdown(timer: Pick<Locator, 'evaluate'>, endsAt: number) {
  const sample = await timer.evaluate((element) => ({
    text: element.textContent ?? '',
    at: Date.now(),
    visibility: document.visibilityState,
  }));
  const receivedAt = Date.now();
  const seconds = countdownSeconds(sample.text);
  return {
    ...sample,
    receivedAt,
    seconds,
    driftSeconds: Math.abs(seconds - Math.ceil((endsAt - sample.at) / 1000)),
  };
}
// These deployed RPCs read public/table context without purchasing or reserving anything.
const OBSERVER_READ_RPCS = new Set([
  'fn_db_now',
  'fn_mystery_bounty_table_state',
  'fn_player_spendable_balance',
  'fn_platform_capabilities',
  'fn_rg_require_not_excluded',
  'fn_batch_club_member_counts',
  'fn_table_chat_is_silenced',
  'fn_time_bank_allowance_v2',
  'fn_bbj_mini_for_club',
  'fn_bbj_pool_for_club',
]);
// Auth-bound housekeeping for the workflow's reserved identity, not gameplay writes.
const OBSERVER_SESSION_RPCS = new Set([
  'ca_claim_active_login',
  'ca_record_device_sighting',
  'fn_report_client_errors',
]);
/** Login achievements can award currency: suppress this incidental mount call explicitly. */
export function suppressedObserverReward(method: string, url: URL): boolean {
  return method === 'POST' && /\/rest\/v1\/rpc\/fn_achievement_record_login\/?$/.test(url.pathname);
}
/** No participation request reaches a real player/table. Unknown RPCs remain refused. */
export function forbiddenAddOnParticipation(
  method: string,
  url: URL,
  observerId?: string,
  body?: unknown
): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const path = url.pathname.toLowerCase().replace(/\/+$/, '');
  if (url.hostname === 'engine.smarter.poker')
    return method !== 'POST' || !['/heartbeat', '/client-event'].includes(path);
  if (
    /\/rest\/v1\/(?:table_seats|tournament_players|wallets|wallet_transactions|chip_ledger|chip_transactions|club_members)$/.test(
      path
    )
  )
    return true;
  const rpc = path.match(/\/rpc\/([^/]+)$/)?.[1];
  if (rpc && OBSERVER_READ_RPCS.has(rpc)) return false;
  if (rpc && observerId && UUID.test(observerId)) {
    if (OBSERVER_SESSION_RPCS.has(rpc)) return false;
    if (rpc === 'fn_update_presence')
      return (
        !body ||
        typeof body !== 'object' ||
        (body as Record<string, unknown>).p_user_id !== observerId
      );
  }
  if (rpc)
    return !/^(?:(?:fn_|ca_)?(?:get|read|list|fetch|can|has|is)_|fn_cash_effective_buyin$)/.test(
      rpc
    );
  return /\/(?:action|buyin|buy-in|cashout|cash-out|addchips|rebuy|leave|seat-move|seat-change|register|transfer-chips|mint-chips)$/.test(
    path
  );
}

/** A reload's first value is not evidence of an update on the original page. */
export function hasNaturalAddOnIncrement(
  tableIds: string[],
  changes: { tableId: string; at: number; count: number }[],
  signals: { tableId: string; at: number }[],
  originalPageEnds: Record<string, number>
): boolean {
  return tableIds.some((id) => {
    const samples = changes.filter(
      (sample) => sample.tableId === id && sample.at < (originalPageEnds[id] ?? Infinity)
    );
    return samples.some(
      (sample, index) =>
        index > 0 &&
        sample.count > samples[index - 1].count &&
        signals.some((signal) => signal.tableId === id && signal.at <= sample.at)
    );
  });
}
