/**
 * Recognise the freeze guard's refusal wherever a money RPC is called.
 *
 * During a maintenance break, every chip- or seat-moving write is refused in
 * Postgres (zz_freeze_guard, errcode 55006, message prefixed PLATFORM_FROZEN).
 * That refusal is CORRECT behaviour, and it must never be shown to a player as
 * a raw database error: the honest message is that the platform is on a short
 * break and their action will succeed in a few minutes.
 *
 * THE SENTENCE NAMES NO CLOCK TIME (Dan 2026-11-07). It used to say the break
 * was "scheduled" and that play resumes "at the top of the hour". Cash games
 * no longer freeze hourly; a freeze now comes from the daily 04:00 window, a
 * certified engine cutover or a recovery window, any of which can start at any
 * minute. At 13:20 Chicago an owner-ordered cutover froze entry for seven
 * minutes and both Lightning joins (NLH and PLO) were refused with a sentence
 * telling the player to wait until 14:00 for a break that ended at 13:21.
 * Every freeze is at most a few minutes long, so that is what the line says.
 * tests/a-maintenance-refusal-names-no-clock-time.law.test.ts holds this.
 *
 * Copy rules (CLAUDE.md 5.7 / 10.7): Title Case, no em dashes - this string
 * goes through the Toast layer verbatim.
 */

export const PLATFORM_FROZEN_MESSAGE =
  'The Platform Is On A Short Maintenance Break. Nothing Is Lost. Please Try Again In A Few Minutes.';

export function isPlatformFrozenError(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    code?: string;
    reason?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  if (e.code === '55006') return true;
  if (e.reason === 'platform_frozen') return true;
  const text = `${e.reason ?? ''} ${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`;
  return /PLATFORM_FROZEN/i.test(text);
}

/** The message a player should see for `err`, or null when it is not the freeze. */
export function platformFrozenMessage(err: unknown): string | null {
  return isPlatformFrozenError(err) ? PLATFORM_FROZEN_MESSAGE : null;
}
