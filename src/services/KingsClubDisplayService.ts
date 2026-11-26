import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';

export interface KingsClubDisplayTotals {
  member_total: number | null;
  active_total: number | null;
  member_addition: number;
  active_addition: number;
  /** 'union' (default once in a union): active_total is the union floor. */
  active_source?: 'union' | 'club';
  active_union_name?: string | null;
}

let pending: Promise<KingsClubDisplayTotals | null> | null = null;

export function readKingsClubDisplayTotals(): Promise<KingsClubDisplayTotals | null> {
  pending ??= fetchTotals().finally(() => {
    pending = null;
  });
  return pending;
}

async function fetchTotals(): Promise<KingsClubDisplayTotals | null> {
  try {
    const { data, error } = await supabase.rpc('fn_kings_club_display_totals');
    if (error) throw error;
    const totals = data as Partial<KingsClubDisplayTotals> | null;
    if (
      totals &&
      (typeof totals.member_total === 'number' || totals.member_total === null) &&
      (typeof totals.active_total === 'number' || totals.active_total === null) &&
      typeof totals.member_addition === 'number' &&
      typeof totals.active_addition === 'number'
    ) {
      return {
        member_total: totals.member_total,
        active_total: totals.active_total,
        member_addition: totals.member_addition,
        active_addition: totals.active_addition,
        active_source:
          totals.active_source === 'club' || totals.active_source === 'union'
            ? totals.active_source
            : undefined,
        active_union_name:
          typeof totals.active_union_name === 'string' ? totals.active_union_name : null,
      };
    }
  } catch (error) {
    reportError(error, 'KingsClubDisplayService.read');
  }
  return null;
}
