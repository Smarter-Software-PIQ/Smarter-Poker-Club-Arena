import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';

export interface KingsClubDisplayTotals {
  member_total: number | null;
  active_total: number | null;
  member_addition: number;
  active_addition: number;
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
      };
    }
  } catch (error) {
    reportError(error, 'KingsClubDisplayService.read');
  }
  return null;
}
