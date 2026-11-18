import { supabase } from '../lib/supabase';
import { isUUID } from '../utils/clubIdResolver';
import { runWithRequestDeadline } from '../utils/requestDeadline';

export interface PromoIntegrityCase {
  case_id: string;
  created_at: string;
  held: number;
  original_amount?: number;
  can_release: boolean;
  review_club_id: string;
  reason: string;
  evidence: Record<string, unknown> | null;
}
export interface PromoIntegrityReview {
  cases: PromoIntegrityCase[];
  wallet_held: number;
  agent_held: number;
}
function amount(value: unknown): number {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && value.trim() === '') ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new Error('Source Review Amount Is Unavailable');
  return Number(value);
}
export function parsePromoIntegrityReview(
  raw: unknown,
  clubId: string,
  userId: string
): PromoIntegrityReview {
  if (!raw || typeof raw !== 'object') throw new Error('Source Review Is Unavailable');
  const row = raw as Record<string, unknown>;
  if (
    row.success !== true ||
    row.club_id !== clubId ||
    row.user_id !== userId ||
    !Array.isArray(row.cases)
  )
    throw new Error('Source Review Could Not Be Read');
  const cases = row.cases.map((item: unknown): PromoIntegrityCase => {
    if (!item || typeof item !== 'object') throw new Error('Source Review Case Is Unavailable');
    const record = item as Record<string, unknown>;
    if (
      !isUUID(record.case_id as string) ||
      !isUUID(record.review_club_id as string) ||
      typeof record.created_at !== 'string' ||
      !Number.isFinite(Date.parse(record.created_at)) ||
      record.status !== 'pending_review' ||
      typeof record.can_release !== 'boolean' ||
      typeof record.reason !== 'string' ||
      (record.evidence !== null &&
        (!record.evidence || typeof record.evidence !== 'object' || Array.isArray(record.evidence)))
    )
      throw new Error('Source Review Case Is Unavailable');
    return {
      case_id: record.case_id as string,
      review_club_id: record.review_club_id as string,
      created_at: record.created_at,
      held: amount(record.held),
      original_amount:
        record.original_amount === undefined ? undefined : amount(record.original_amount),
      can_release: record.can_release,
      reason: record.reason,
      evidence: record.evidence as Record<string, unknown> | null,
    };
  });
  if (new Set(cases.map((item) => item.case_id)).size !== cases.length)
    throw new Error('Source Review Contains Duplicate Cases');
  return { cases, wallet_held: amount(row.wallet_held), agent_held: amount(row.agent_held) };
}
export async function readPromoIntegrityReview(
  clubId: string,
  userId: string,
  signal?: AbortSignal
) {
  if (!isUUID(clubId) || !isUUID(userId)) throw new Error('Choose A Member To Review');
  const { data, error } = await runWithRequestDeadline(
    (requestSignal) =>
      supabase
        .rpc('fn_ca_promo_integrity_read', { p_club: clubId, p_user: userId })
        .abortSignal(requestSignal),
    { signal }
  );
  if (error) throw error;
  return parsePromoIntegrityReview(data, clubId, userId);
}
export async function releasePromoIntegrityCase(caseId: string, reason: string) {
  if (!isUUID(caseId) || reason.trim().length < 1 || reason.trim().length > 500)
    throw new Error('A Case And A Review Reason Are Required');
  const { data, error } = await runWithRequestDeadline((signal) =>
    supabase
      .rpc('fn_ca_promo_integrity_release', { p_case: caseId, p_reason: reason.trim() })
      .abortSignal(signal)
  );
  if (error) throw error;
  if (data?.success !== true || data.case_id !== caseId)
    throw new Error(data?.error || 'Source Review Could Not Be Confirmed');
  return data;
}
