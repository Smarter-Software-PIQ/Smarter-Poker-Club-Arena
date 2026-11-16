import { runWithRequestDeadline } from '../utils/requestDeadline';
import { supabase } from '../lib/supabase';
import { isUUID, resolveClubUUID } from '../utils/clubIdResolver';

export interface PromoPlayThroughSummary {
  locked: number;
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
  if (
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

export async function readMyPromoPlayThrough(clubId: string): Promise<PromoPlayThroughSummary> {
  const clubUUID = await resolveClubUUID(clubId);
  if (!isUUID(clubUUID)) throw new Error('That Club Could Not Be Resolved');
  const { data, error } = await runWithRequestDeadline((signal) =>
    supabase.rpc('fn_ca_my_promo_play_through', { p_club_id: clubUUID }).abortSignal(signal)
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
