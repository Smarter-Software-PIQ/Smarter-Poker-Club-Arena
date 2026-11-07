/**
 * The Share & Invite code format, in one pure module with no client imports,
 * so link builders (handHistoryLive) can validate a code without loading the
 * Supabase client. ClubInviteService re-exports it; there is one rule.
 * Seven characters from an alphabet without 0/O/1/I (fn_club_invite_link).
 */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{7}$/;

export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return INVITE_CODE_RE.test(v) ? v : null;
}
