/**
 * ONE RELEASE WITHOUT ADVANCE PLAYER NOTICE (Dan 2026-11-17, 11:05 Chicago).
 *
 * The owner ordered the next qualified engine cutover with no advance
 * player-warning announcement, in these exact words (they are retained in the
 * booked window's ownerOrder and in its ownerNoticeWaiver field):
 *
 *   "For this release, execute the earliest qualified engine cutover without
 *    an advance player-warning announcement or notice countdown. Preserve safe
 *    hand completion, settlement, certification, admission, recovery and live
 *    verification."
 *
 * That supersedes, for this release only, the 2026-11-07 rule that every
 * booked window carries playerNoticeAt at least twenty minutes ahead
 * (tests/a-booked-window-gives-players-notice.law.test.ts). It changes nothing
 * else: certification, admission, the engine's own last-hand drain, the
 * freeze, settlement, seal, thaw and recovery are untouched, and no notice
 * timestamp is invented.
 *
 * A window is waived only when ALL of these hold:
 *   - it is an ENGINE window (databaseWindows are never waived);
 *   - ownerNoticeWaiver is the exact instruction above;
 *   - ownerOrder contains the exact instruction;
 *   - it carries no playerNoticeAt (a waived window never claims a notice);
 *   - it has a real ISO notAfter (no expiry: standing order, see below).
 * Anything else that carries an ownerNoticeWaiver field is refused.
 */
export const OWNER_NOTICE_WAIVER_INSTRUCTION =
  'For this release, execute the earliest qualified engine cutover without an advance ' +
  'player-warning announcement or notice countdown. Preserve safe hand completion, settlement, ' +
  'certification, admission, recovery and live verification.';

/**
 * STANDING ORDER (Dan, 2026-11-17 20:23 America/Chicago, verbatim): "REMOVE THE
 * ANNOUNCEMENT, I NEVER ASKED FOR IT, AND DON'T WANT IT APART OF ANY FUTURE ENGINE
 * CUT OVER REQUIREMENTS EVER AGAIN! GET THIS CUT OVER AT THE EARLIEST POSSIBLE TIME!"
 * The one-release expiry (2026-11-18T09:30Z) and the single-window pin of #11238
 * are retired: every engine window may carry the waiver, and the booking command
 * books without an advance notice by default.
 */

/** True only for an engine window that carries the exact owner waiver and a real closing instant. */
export function ownerNoticeWaived(w, collection = 'windows') {
  if (collection !== 'windows' || !w || typeof w !== 'object') return false;
  const closes = typeof w.notAfter === 'string' ? Date.parse(w.notAfter) : NaN;
  return (
    w.ownerNoticeWaiver === OWNER_NOTICE_WAIVER_INSTRUCTION &&
    !('playerNoticeAt' in w) &&
    typeof w.ownerOrder === 'string' &&
    w.ownerOrder.includes(OWNER_NOTICE_WAIVER_INSTRUCTION) &&
    Number.isFinite(closes)
  );
}

/** Why a record that names a waiver may not use it, or null. */
export function ownerNoticeWaiverProblem(w, collection = 'windows') {
  if (!w || typeof w !== 'object' || !('ownerNoticeWaiver' in w)) return null;
  if (ownerNoticeWaived(w, collection)) return null;
  return (
    'ownerNoticeWaiver is accepted only on an engine window that carries the exact owner ' +
    'instruction in ownerNoticeWaiver and ownerOrder, no playerNoticeAt, and an ISO notAfter'
  );
}
