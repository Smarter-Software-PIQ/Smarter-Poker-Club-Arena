/**
 * The words a tournament break card uses (Dan 2026-11-07).
 *
 * Two facts the card used to hide:
 *  - while the break waits on the last hand, HOW MANY tables are still
 *    playing (one slow decision reads as "Waiting On 1 Table", not an
 *    unexplained wait);
 *  - that the 03:55 break overlaps the daily engine update and ends when the
 *    update ends, so it runs about ten minutes, not five.
 *
 * Popup copy rules apply (CLAUDE.md 5.7): Title Case, no em dashes.
 */
const tables = (n: number): string => `${n} Table${n === 1 ? '' : 's'}`;

const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export function breakConsoleTitle(addOn: boolean, extendedForDailyUpdate: boolean): string {
  if (addOn) return 'Add-On Break';
  return extendedForDailyUpdate ? 'Extended Break' : 'Tournament Break';
}

export function breakWaitingLabel(tablesFinishing: number | null | undefined): string {
  return known(tablesFinishing)
    ? `Waiting On ${tables(tablesFinishing)} To Finish`
    : 'Waiting For Every Table To Finish';
}

export function breakCountdownLabel(extendedForDailyUpdate: boolean): string {
  return extendedForDailyUpdate ? 'Daily Update: Play Resumes In' : 'Play Resumes In';
}

export function breakMiniState(
  countingDown: boolean,
  extendedForDailyUpdate: boolean,
  tablesFinishing: number | null | undefined
): string {
  if (countingDown) return extendedForDailyUpdate ? 'Daily Update' : 'Paused';
  return known(tablesFinishing) ? `${tables(tablesFinishing)} Left` : 'Finishing Hands';
}
