/**
 * Which live figure a union member club's card prints as ACTIVE.
 *
 * Dan 2026-11-26: "ONCE A CLUB 'JOINS THE UNION' THERE CLUB DATA SHOULD REPORT
 * WHATS 'LIVE IN THE UNION' AT THAT MOMENT. IT SHOULD NO LONGER DISPLAY THERE
 * CLUB DATA BY DEFAULT. THEY CAN CHANGE IT IN THE CLUB SETTINGS IF THEY WANT TO
 * DISPLAY THERE REAL TIME CLUB DATA, OVER UNION DATA."
 *
 * The choice lives in clubs.settings.card_active_source ('union' | 'club').
 * Absent means the default: a club in a union reports the union. This mirrors
 * public.fn_club_card_active_source exactly; change both together.
 */
export type ClubCardActiveSource = 'union' | 'club';

export const CARD_ACTIVE_SOURCE_KEY = 'card_active_source';

export function storedCardActiveSource(settings: unknown): ClubCardActiveSource | null {
  if (!settings || typeof settings !== 'object') return null;
  const value = (settings as Record<string, unknown>)[CARD_ACTIVE_SOURCE_KEY];
  return value === 'club' || value === 'union' ? value : null;
}

export function clubCardActiveSource(row: {
  union_id?: string | null;
  settings?: unknown;
}): ClubCardActiveSource {
  if (!row.union_id) return 'club';
  return storedCardActiveSource(row.settings) === 'club' ? 'club' : 'union';
}
