/**
 * THE NOTIFICATIONS ARENA DRESS IS SCOPED TO ITS PAGE (#SmarterDesign player
 * pages batch P1, 2026-11-28)
 *
 * PushEnableBanner keeps its own inked #ClubArenaConsole sheet. On the
 * Notifications page, which wears the arena workspace, the banner is dressed
 * in a chrome case with its action as the lit key. That dress lives in
 * NotificationsPage.css and every rule of it is scoped under the page's arena
 * root, so no other surface that mounts the banner changes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageCss = readFileSync('src/pages/NotificationsPage.css', 'utf8');
const bannerCss = readFileSync('src/components/notifications/PushEnableBanner.css', 'utf8');
const page = readFileSync('src/pages/NotificationsPage.tsx', 'utf8');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s));
}

describe('the Notifications arena dress is scoped', () => {
  it('the page root carries the arena workspace', () => {
    expect(page).toContain('className="ca-notif arena-workspace"');
  });

  it('dresses the push banner only under the Notifications arena root', () => {
    const banner = selectors(pageCss)
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter((s) => s.includes('ca-push-banner'));
    expect(banner.length).toBeGreaterThan(5);
    for (const s of banner) expect(s.startsWith('.ca-notif.arena-workspace ')).toBe(true);
  });

  it('leaves the banner sheet itself untouched by the arena', () => {
    expect(bannerCss).not.toContain('arena');
  });
});
