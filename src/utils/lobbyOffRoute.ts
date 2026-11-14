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
 * 3. RESTORE BY ANY GESTURE - a pill tap goes through handleTabSelect, but a
 *    swipe, a number key or the tile grid moves the index directly. When the
 *    tab becomes the visible one from ANOTHER tab while it remembers a page,
 *    the index is put back for this frame and the page is navigated to, so
 *    every way of reaching the tab lands on the same page.
 * 4. CLEAR - when the tab comes back from its own page into the container
 *    (Back out of Player Management, "+" Lobby while on it), the game lobby is
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
  /**
   * The /table path the restore navigated FROM. If the route moves to a
   * different /table path instead of the page (a redirect, a seat arriving),
   * the restore is abandoned rather than left pending for ever.
   */
  pendingFromPath?: string | null;
  prev: { hidden: boolean; tabId: string | null };
  navigationType: 'POP' | 'PUSH' | 'REPLACE';
}

export interface OffRouteDecision {
  /** Focus this index (a pending restore has reached its page). */
  focusIndex: number | null;
  /** Whether the pending restore is consumed by this commit. */
  consumePending: boolean;
  record: { tabId: string; path: string } | null;
  /** Go back to this tab's page; put the index back first when possible. */
  restore: { tabId: string; path: string; revertIndex: number | null } | null;
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
  let pendingTabId = input.pendingTabId;
  if (pendingTabId && !hidden && input.pendingFromPath != null && input.pendingFromPath !== path) {
    consumePending = true;
    pendingTabId = null;
  }

  if (hidden && pendingTabId) {
    consumePending = true;
    const idx = tabs.findIndex((t) => t.id === pendingTabId);
    if (idx !== -1 && idx !== activeIndex) {
      focusIndex = idx;
      activeIndex = idx;
    }
  }

  const cur = tabs[activeIndex];
  const curId = cur?.id ?? null;
  let record: OffRouteDecision['record'] = null;
  let restore: OffRouteDecision['restore'] = null;
  const clear: string[] = [];

  if (hidden) {
    if (cur?.isLobby && !NEVER_REMEMBERED.test(path) && cur.lobbyOffRoutePath !== path) {
      record = { tabId: cur.id, path };
    }
  } else if (!pendingTabId) {
    if (cur?.isLobby && cur.lobbyOffRoutePath) {
      if (prev.tabId === cur.id) {
        clear.push(cur.id);
      } else {
        const back = prev.tabId ? tabs.findIndex((t) => t.id === prev.tabId) : -1;
        restore = {
          tabId: cur.id,
          path: cur.lobbyOffRoutePath,
          revertIndex: back === -1 ? null : back,
        };
      }
    }
    if (prev.hidden && navigationType === 'POP' && prev.tabId && prev.tabId !== curId) {
      const left = tabs.find((t) => t.id === prev.tabId);
      if (left?.isLobby && left.lobbyOffRoutePath) clear.push(left.id);
    }
  }

  // A restore keeps `prev` on the tab the player is still looking at, so the
  // page arriving is not mistaken for a return from it.
  const nextTabId = restore && restore.revertIndex !== null ? prev.tabId : curId;
  return {
    focusIndex,
    consumePending,
    record,
    restore,
    clear,
    nextPrev: { hidden, tabId: nextTabId },
  };
}
