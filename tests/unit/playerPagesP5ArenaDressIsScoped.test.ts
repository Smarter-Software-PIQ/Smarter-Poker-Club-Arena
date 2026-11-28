/**
 * SETTINGS, PROFILE AND CONNECTIONS: THE ARENA DRESS IS SCOPED TO EACH PAGE
 * (#SmarterDesign player pages batch P5, 2026-11-28)
 *
 * Each page wears the arena workspace: the root carries `arena-workspace` and
 * the chrome mast. Every rule of the Connections sheet is scoped under its
 * arena root, so the friend rows, keys and wells change nowhere else. The two
 * account pages are CSS modules; the only rules they aim at a shared component
 * (the Action Controller picker, which the table drawer and Table Studio also
 * render) sit under the Settings page's own sections, and the shared sheet
 * itself is not edited, so its approved previews are never repainted.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(/,(?![^(]*\))/))
    .map((s) => s.replace(/\s+/g, ' ').trim());
}

describe('the P5 player pages wear the arena workspace', () => {
  it.each([
    [
      'src/pages/SettingsPage.tsx',
      'className={`${styles.page} arena-workspace`}',
      'area="control"',
    ],
    [
      'src/pages/ProfilePage.tsx',
      'className={`${styles.page} arena-workspace`}',
      'area="settings"',
    ],
    ['src/pages/FriendsPage.tsx', 'className="friends-page arena-workspace"', 'area="members"'],
  ])('%s carries the arena root and the chrome mast', (path, root, area) => {
    const page = read(path);
    expect(page).toContain(root);
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain(area);
    expect(page).not.toMatch(/SpadeConsole|\bsc-plate/);
  });
});

describe('the P5 arena dress is scoped', () => {
  it('scopes every Connections rule under the page arena root', () => {
    const all = selectors(read('src/pages/FriendsPage.css'));
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(s.startsWith('.friends-page.arena-workspace')).toBe(true);
  });

  it('aims at the shared Action Controller only inside the Settings sections', () => {
    const settings = selectors(read('src/pages/SettingsPage.module.css'));
    const shared = settings.filter((s) => s.includes(':global(.action-controller'));
    expect(shared.length).toBeGreaterThan(5);
    for (const s of shared) expect(s.startsWith('.page .section :global(')).toBe(true);
    // The previews are approved artwork: the page never dresses a choice.
    expect(shared.some((s) => s.includes('action-controller-choice'))).toBe(false);
  });

  it('puts no global rule in the Profile module', () => {
    const profile = selectors(read('src/pages/ProfilePage.module.css'));
    for (const s of profile.filter((x) => x.includes(':global('))) {
      expect(s.startsWith('.historyContainer :global(.profit-chart')).toBe(true);
    }
  });
});
