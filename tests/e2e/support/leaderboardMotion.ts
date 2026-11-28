import { expect, type Page } from '@playwright/test';

/**
 * Every leaderboard row family that uses entrance motion (`animate-fade-in-up`).
 * LeaderboardPage.tsx animates `.tournament-stats-entry` alongside `.leaderboard-entry`
 * and `.podium-section`; omitting `.tournament-stats-entry` let axe-core read
 * My Clubs Tournament Stats mid-fade at 1440px (Post-Deploy E2E 46108674387).
 */
export const LEADERBOARD_MOTION_SELECTOR =
  '.podium-section, .leaderboard-entry, .tournament-stats-entry';

/** How many ranking entries exist and how many are still entering. Rows for a
 * large field can mount after an earlier wait settled, so a contrast reading is
 * only valid if this is unchanged and still-free of motion after the reading. */
export async function leaderboardMotionSnapshot(
  page: Page,
  boardSelector: string
): Promise<{ entries: number; moving: number }> {
  return page.locator(boardSelector).evaluate((root, selector) => {
    const entries = [...root.querySelectorAll<HTMLElement>(selector)];
    const moving = entries.filter(
      (entry) =>
        entry
          .getAnimations({ subtree: true })
          .some(
            (motion) =>
              Number.isFinite(Number(motion.effect?.getComputedTiming().endTime)) &&
              (motion.playState === 'running' || motion.playState === 'paused' || motion.pending)
          ) || Number(getComputedStyle(entry).opacity) < 1
    ).length;
    return { entries: entries.length, moving };
  }, LEADERBOARD_MOTION_SELECTOR);
}

export async function waitForLeaderboardEntryMotion(
  page: Page,
  boardSelector: string,
  state: string
): Promise<void> {
  // aria-busy ends when rows arrive; their approved entrance motion finishes later.
  // Inspect the settled palette without disabling, shortening or skipping animation.
  await expect
    .poll(
      async () =>
        page.locator(boardSelector).evaluate((root, selector) => {
          const entries = [...root.querySelectorAll<HTMLElement>(selector)];
          return entries.filter(
            (entry) =>
              entry
                .getAnimations({ subtree: true })
                .some(
                  (motion) =>
                    Number.isFinite(Number(motion.effect?.getComputedTiming().endTime)) &&
                    (motion.playState === 'running' ||
                      motion.playState === 'paused' ||
                      motion.pending)
                ) || Number(getComputedStyle(entry).opacity) < 1
          ).length;
        }, LEADERBOARD_MOTION_SELECTOR),
      {
        timeout: 10_000,
        message: `${state}: ranking entrance motion must complete before contrast certification`,
      }
    )
    .toBe(0);
}
