/**
 * A LOBBY TAB KEEPS THE PAGE IT WAS LEFT ON (Dan 2026-11-13).
 *
 * Dan, verbatim: "WHEN I CLICK ON A + BUTTON AND GO TO THE LOBBY. THEN SELECT
 * ANYTHING LIKE PLAYER MANAGEMENT... THEN GO BACK AND VIEW ANOTHER OPEN TAB...
 * BUT GO BACK TO 'LOBBY TAB' AND ITS NO LONGER PLAYER MANAGEMENT IT DEFAULTS
 * BACK TO THE GAME LOBBY... KEEP IT ON THE EXACT PAGE YOU LEFT IT ON".
 *
 * Player Management and every other club page are real routes
 * (`/clubs/:id/members`, ...). Opening one from the "+" lobby tab hides the
 * tab container and the pinned strip keeps the Lobby pill lit, but nothing
 * remembered that the pill now meant that page, so selecting it again
 * borrowed a table URL and painted the club's game lobby.
 *
 * This is the pure decision MultiTablePage applies after every commit:
 *
 * 1. RECORD - while the container is hidden on another route and the selected
 *    pill is a lobby tab, that route is the tab's page. Walking further (a
 *    member's profile, their statistics) replaces it.
 * 2. FOCUS - a restore (selecting the pill) navigates first and focuses the
 *    pill only once the route has left /table/*, so the in-tab game lobby is
 *    never painted on the way.
 * 3. CLEAR - when the tab shows its own in-tab lobby again, the game lobby is
 *    the page the player left it on. Backing out of the page onto a table (a
 *    POP from the hidden page) is leaving the page, so it clears too.
 */

export interface OffRouteTab {
  id: string;
  isLobby: boolean;
  lobbyOffRoutePath?: string;
}

export interface OffRouteInput {
  hidden: boolean;
  /** pathname + search of the current location. */
  path: string;
  tabs: readonly OffRouteTab[];
  activeIndex: number;
  /** A lobby tab whose page restore is navigating; focus it once hidden. */
  pendingTabId: string | null;
  prev: { hidden: boolean; tabId: string | null };
  navigationType: 'POP' | 'PUSH' | 'REPLACE';
}

export interface OffRouteDecision {
  /** Focus this index (a pending restore has reached its page). */
  focusIndex: number | null;
  /** Whether the pending restore is consumed by this commit. */
  consumePending: boolean;
  record: { tabId: string; path: string } | null;
  clear: string[];
  /** The selected tab after this decision, for the next commit's `prev`. */
  nextPrev: { hidden: boolean; tabId: string | null };
}

/** Pages that must never be remembered as a lobby tab's page. */
const NEVER_REMEMBERED = /^\/(auth|table)(\/|$)/;

export function decideLobbyOffRoute(input: OffRouteInput): OffRouteDecision {
  const { hidden, path, tabs, prev, navigationType } = input;
  let activeIndex = input.activeIndex;
  let focusIndex: number | null = null;
  let consumePending = false;

  if (hidden && input.pendingTabId) {
    consumePending = true;
    const idx = tabs.findIndex((t) => t.id === input.pendingTabId);
    if (idx !== -1 && idx !== activeIndex) {
      focusIndex = idx;
      activeIndex = idx;
    }
  }

  const cur = tabs[activeIndex];
  const curId = cur?.id ?? null;
  let record: OffRouteDecision['record'] = null;
  const clear: string[] = [];

  if (hidden) {
    if (cur?.isLobby && !NEVER_REMEMBERED.test(path) && cur.lobbyOffRoutePath !== path) {
      record = { tabId: cur.id, path };
    }
  } else if (!input.pendingTabId) {
    if (cur?.isLobby && cur.lobbyOffRoutePath) clear.push(cur.id);
    if (prev.hidden && navigationType === 'POP' && prev.tabId && prev.tabId !== curId) {
      const left = tabs.find((t) => t.id === prev.tabId);
      if (left?.isLobby && left.lobbyOffRoutePath) clear.push(left.id);
    }
  }

  return { focusIndex, consumePending, record, clear, nextPrev: { hidden, tabId: curId } };
}
