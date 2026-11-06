/**
 * When the push ask may appear (Dan, 2026-11-05). It waits for the first-login
 * phone step so it never stacks on the signup welcome. It used to wait for a
 * VERIFIED phone, forever: 88 of the 128 players in the Tournament Arena
 * relaunch had skipped that step and so were never asked once, which is a
 * large part of why the relaunch push reached 3 devices. The step is settled
 * once the phone is verified, the player skipped it this session, or the
 * account is past its first day. The ask's own cadence (pushNudgePolicy) is
 * unchanged. Same rule as the World Hub's src/lib/push/pushAskGate.mjs.
 */
export const PUSH_ASK_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export interface PushAskProfile {
  phone_verified?: boolean | null;
  created_at?: string | null;
}

export function pushAskMaySettle(
  profile: PushAskProfile | null | undefined,
  { skipped = false, now = Date.now() }: { skipped?: boolean; now?: number } = {}
): boolean {
  if (!profile) return false;
  if (profile.phone_verified === true || skipped) return true;
  const created = Date.parse(profile.created_at || '');
  return Number.isFinite(created) && now - created >= PUSH_ASK_ACCOUNT_AGE_MS;
}

/** The verify-phone page writes this when the player taps Skip (same origin). */
export function phonePromptSkipped(): boolean {
  try {
    return sessionStorage.getItem('phone_prompt_skipped') === '1';
  } catch {
    return false;
  }
}
