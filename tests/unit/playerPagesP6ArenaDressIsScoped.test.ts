/**
 * THE P6 PLAYER PAGES' ARENA DRESS IS SCOPED TO EACH PAGE
 * (#SmarterDesign player pages batch P6, 2026-11-28)
 *
 * /bonuses, /vip and /search wear the arena workspace. The Daily Bonus sheet is shared
 * with the modal the shell raises on entry, so the sheet's own stylesheet is
 * untouched and every rule that dresses it sits under the page's arena root;
 * the modal keeps its painted console. VIP's membership plate and Diamond
 * Activity take an opt-in `arena` prop that only /vip passes, and VIP's own
 * painted sheet stays as the marketplace contract pins it, overridden only
 * under the page root. Search keeps its own CSS module (the global-class
 * collision law) with every rule under the module's page root. Each rule here is the shape of a regression that would
 * leak the arena onto another host or bring the painted header back.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

/** Every selector in a sheet, comments and keyframe steps left out. */
function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(/,(?![^(]*\))/))
    .map((s) => s.trim());
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Daily Bonus wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/DailyBonusPage.tsx');
  const css = read('src/pages/DailyBonusPage.css');

  it('the page root carries the arena workspace and the chrome mast, never the painted header', () => {
    expect(page).toContain('className="daily-bonus-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('className="arena-case arena-ops-case daily-bonus-page__case"');
    expect(page).toContain('className="arena-section-title"');
    expect(page).not.toContain('RewardsSurfaceHeader');
    expect(page).not.toContain('SpadeConsole');
    // The sheet prints its frameless glass variant inside the case.
    expect(page).toContain('mode="inline" chassis="glass"');
  });

  it('every rule in the page sheet sits under the page arena root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(s.startsWith('.daily-bonus-page.arena-workspace')).toBe(true);
  });

  it('leaves the shared sheet stylesheet untouched by the arena', () => {
    expect(read('src/components/daily-bonus/DailyBonusSheet.css')).not.toContain('arena');
  });

  it('only this page sets the sheet on its glass', () => {
    const hosts = sources('src')
      .filter((path) => /<DailyBonusSheet\b[^>]*chassis="glass"/.test(read(path)))
      .sort();
    expect(hosts).toEqual([join('src', 'pages', 'DailyBonusPage.tsx')]);
  });
});

describe('VIP wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/VIPPage.tsx');
  const css = read('src/pages/VIPPageArena.css');

  it('the page root carries the arena workspace and the chrome mast, never the page bar header', () => {
    expect(page.match(/className="vip-page arena-workspace"/g)).toHaveLength(2);
    expect(page.match(/<ArenaWorkspaceHeader/g)).toHaveLength(2);
    expect(page).not.toContain('RewardsSurfaceHeader');
    expect(page).toContain("import './VIPPageArena.css';");
    expect(page).toContain('className="diamond-balance__actions arena-switch arena-ops-primary"');
    expect(page).toContain('className="purchase-card arena-ledger-row"');
  });

  it('every rule in the arena sheet sits under the page arena root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(60);
    for (const s of all) expect(s.startsWith('.vip-page.arena-workspace')).toBe(true);
  });

  it('leaves the painted sheets themselves free of the arena', () => {
    for (const path of [
      'src/pages/VIPPage.css',
      'src/components/vip/VIPMembershipPlate.css',
      'src/components/vip/VIPActivityHistory.css',
      'src/components/vip/VIPPerksGrid.css',
    ])
      expect(read(path)).not.toContain('arena');
  });

  it('only /vip opts the plate and the activity into the arena', () => {
    const optIns = sources('src')
      .filter((path) => /<(VIPMembershipPlate|VIPActivityHistory)\b[^>]*\barena\b/.test(read(path)))
      .sort();
    expect(optIns).toEqual([join('src', 'pages', 'VIPPage.tsx')]);
    // The components stay off by default.
    expect(read('src/components/vip/VIPMembershipPlate.tsx')).toContain('arena = false');
    expect(read('src/components/vip/VIPActivityHistory.tsx')).toContain('arena = false');
  });
});

describe('Community Search wears the arena workspace, inside its own module', () => {
  const page = read('src/pages/SearchPage.tsx');
  const css = read('src/pages/SearchPage.module.css');

  it('the page root carries the arena workspace and the chrome mast, never the community page bar', () => {
    expect(page).toContain('<main className={`${styles.page} arena-workspace`}>');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('CommunitySurfaceHeader');
    expect(page).toContain('`${styles.console} arena-case arena-ops-case`');
    expect(page).toContain('`${styles.indexStrip} arena-switch arena-ops-keys`');
    expect(page).toContain('`${styles.categoryRail} arena-switch`');
    expect(page.match(/`\$\{styles\.card\} arena-ledger-row`/g)).toHaveLength(4);
    expect(page.match(/`\$\{styles\.actions\} arena-switch`/g)).toHaveLength(4);
  });

  it('every rule in the module sits under the page root, and none is global', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(60);
    for (const s of all) expect(s === '.page' || s.startsWith('.page ')).toBe(true);
    expect(css).not.toContain(':global');
  });
});
