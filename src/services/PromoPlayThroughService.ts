import { runWithRequestDeadline } from '../utils/requestDeadline';
import { supabase } from '../lib/supabase';
import { isUUID, resolveClubUUID } from '../utils/clubIdResolver';

export interface PromoPlayThroughSummary {
  locked: number;
  wallet_locked?: number;
  agent_locked?: number;
  agent_wallet?: number | null;
  agent_cashable?: number | null;
  wallet_profit_locked?: number;
  agent_profit_locked?: number;
  profit_locked?: number;
  profit_fee_target?: number;
  profit_fee_progress?: number;
  profit_fee_remaining?: number;
  profit_percent?: number;
  expired_locked?: number;
  integrity_available?: boolean;
  override_available?: boolean;
  integrity_review_available?: boolean;
  integrity_held?: number;
  agent_integrity_held?: number;
  integrity_total_held?: number;
  open_grants: number;
  fee_target: number;
  fee_progress: number;
  fee_remaining: number;
  percent: number;
  wallet: number;
  cashable: number;
  next_expiry_at: string | null;
}

/** Missing or malformed money is unavailable, never an invented zero. */
export function parsePromoPlayThrough(raw: unknown): PromoPlayThroughSummary {
  if (!raw || typeof raw !== 'object') throw new Error('Promo Progress Is Unavailable');
  const row = raw as Record<string, unknown>;
  if (row.success !== true) throw new Error('Promo Progress Could Not Be Read');
  const fields = [
    'locked',
    'open_grants',
    'fee_target',
    'fee_progress',
    'fee_remaining',
    'percent',
    'wallet',
    'cashable',
  ] as const;
  const result = {} as PromoPlayThroughSummary;
  for (const key of fields) {
    const value = row[key];
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '') ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    ) {
      throw new Error('Promo Progress Is Unavailable');
    }
    result[key] = Number(value);
  }
  for (const key of ['override_available', 'integrity_review_available'] as const) {
    if (row[key] !== undefined && typeof row[key] !== 'boolean')
      throw new Error('Promo Support Is Unavailable');
    result[key] = row[key] === true;
  }
  result.integrity_available =
    row.integrity_held !== undefined && row.agent_integrity_held !== undefined;
  for (const key of [
    'integrity_held',
    'agent_integrity_held',
    'integrity_total_held',
    'expired_locked',
    'wallet_locked',
    'agent_locked',
    'wallet_profit_locked',
    'agent_profit_locked',
    'profit_locked',
    'profit_fee_target',
    'profit_fee_progress',
    'profit_fee_remaining',
    'profit_percent',
  ] as const) {
    // Missing position-specific fields never borrow aggregate grant custody.
    const value = row[key] === undefined ? 0 : row[key];
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '') ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    )
      throw new Error(
        key === 'expired_locked'
          ? 'Expired Promo Is Unavailable'
          : key.startsWith('integrity_') || key === 'agent_integrity_held'
            ? 'Review Hold Is Unavailable'
            : 'Promo Progress Is Unavailable'
      );
    result[key] = Number(value);
  }
  for (const key of ['agent_wallet', 'agent_cashable'] as const) {
    const value = row[key];
    if (value === undefined || value === null) {
      result[key] = null;
    } else if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '') ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    ) {
      throw new Error('Agent Wallet Is Unavailable');
    } else result[key] = Number(value);
  }
  if (
    (result.agent_wallet === null) !== (result.agent_cashable === null) ||
    (result.agent_cashable ?? 0) > (result.agent_wallet ?? 0)
  )
    throw new Error('Agent Wallet Is Unavailable');
  if (
    (result.profit_percent ?? 0) > 100 ||
    (result.profit_fee_progress ?? 0) > (result.profit_fee_target ?? 0) ||
    result.percent > 100 ||
    !Number.isInteger(result.open_grants) ||
    result.cashable > result.wallet ||
    result.fee_progress > result.fee_target
  ) {
    throw new Error('Promo Progress Is Unavailable');
  }
  if (
    row.next_expiry_at !== null &&
    (typeof row.next_expiry_at !== 'string' || !Number.isFinite(Date.parse(row.next_expiry_at)))
  ) {
    throw new Error('Promo Expiry Is Unavailable');
  }
  result.next_expiry_at = row.next_expiry_at as string | null;
  return result;
}

export async function readMyPromoPlayThrough(
  clubId: string,
  signal?: AbortSignal
): Promise<PromoPlayThroughSummary> {
  const clubUUID = await resolveClubUUID(clubId);
  if (!isUUID(clubUUID)) throw new Error('That Club Could Not Be Resolved');
  const { data, error } = await runWithRequestDeadline(
    (requestSignal) =>
      supabase
        .rpc('fn_ca_my_promo_play_through', { p_club_id: clubUUID })
        .abortSignal(requestSignal),
    { signal }
  );
  if (error) throw error;
  return parsePromoPlayThrough(data);
}

export async function readMemberPromoPlayThrough(
  clubId: string,
  userIds: readonly string[],
  signal?: AbortSignal
): Promise<Record<string, PromoPlayThroughSummary>> {
  if (userIds.length === 0) return {};
  if (userIds.length > 100 || userIds.some((id) => !isUUID(id)))
    throw new Error('Choose Up To 100 Members');
  const { data, error } = await runWithRequestDeadline(
    (requestSignal) =>
      supabase
        .rpc('fn_ca_members_promo_play_through', {
          p_club_id: clubId,
          p_user_ids: [...userIds],
        })
        .abortSignal(requestSignal),
    { signal }
  );
  if (error) throw error;
  if (data?.success !== true || !data.members || typeof data.members !== 'object') {
    throw new Error('Promo Progress Could Not Be Read');
  }
  const members: Record<string, PromoPlayThroughSummary> = {};
  for (const id of userIds) {
    if (data.members[id]) members[id] = parsePromoPlayThrough(data.members[id]);
  }
  return members;
}

/** Existing owner/admin door records its actor and required reason atomically. */
export async function overrideMemberPromoPlayThrough(
  clubId: string,
  userId: string,
  reason: string
) {
  if (!isUUID(clubId) || !isUUID(userId) || !reason.trim())
    throw new Error('A Member And An Unlock Reason Are Required');
  const { data, error } = await runWithRequestDeadline((signal) =>
    supabase
      .rpc('fn_ca_promo_play_through_override', {
        p_club_id: clubId,
        p_user_id: userId,
        p_note: reason.trim(),
      })
      .abortSignal(signal)
  );
  if (error) throw error;
  if (data?.success !== true) throw new Error(data?.error || 'Promo Unlock Could Not Be Confirmed');
  return data;
}
