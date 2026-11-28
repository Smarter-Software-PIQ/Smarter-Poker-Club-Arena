/**
 * THE D1 PAGES' ARENA DRESS IS SCOPED TO EACH PAGE
 * (#SmarterDesign batch D1, 2026-11-28)
 *
 * Earn Diamonds, the Lightning entry and Flash Pool wear the arena workspace.
 * Each page's own sheet dresses only that page (every rule under its arena
 * root), so a game page or the lobby that loads the same chunk never picks it
 * up. The Diamond Spins tabs take an opt-in `arena` prop that only Earn
 * Diamonds passes; the wheel, the bonus games and Mines / Crossing / Plinko
 * keep their printed links. Each rule here is the shape of a regression that
 * would leak the arena onto another host or bring a painted frame back.
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

/** A sheet a page owns draws no radius, gradient or shadow of its own. */
function ownsNoNewDress(css: string) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(stripped).not.toMatch(/border-radius|gradient\(|box-shadow|:hover/);
}

describe('Earn Diamonds wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/DiamondEarnPage.tsx');
  const css = read('src/pages/DiamondEarnPage.css');

  it('the page root carries the arena workspace and the chrome mast, never a painted console', () => {
    expect(page).toContain('className="arena-workspace diamond-earn-page"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('className="arena-case arena-ops-case diamond-earn-case"');
    expect(page).toContain('className="arena-section-title" aria-labelledby={titleId}');
    expect(page).toContain('className="arena-switch arena-ops-keys arena-ops-primary"');
    expect(page).toContain("<DiamondSpinsTabs clubId={clubId ?? ''} arena />");
    expect(page).not.toContain('SpadeConsole');
    expect(page).not.toContain('PageBar');
  });

  it('every rule in the page sheet sits under the page arena root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(6);
    for (const s of all) expect(s.startsWith('.arena-workspace.diamond-earn-page')).toBe(true);
    ownsNoNewDress(css);
  });

  it('only Earn Diamonds passes the tabs their arena dress', () => {
    const hosts = sources('src').filter((path) =>
      /<DiamondSpinsTabs\b[^>]*\barena\b/.test(read(path))
    );
    expect(hosts).toEqual([join('src', 'pages', 'DiamondEarnPage.tsx')]);
    const tabs = read('src/components/games/DiamondSpinsTabs.tsx');
    expect(tabs).toContain("arena ? 'arena-switch' : styles.spinsTabs");
  });
});

describe('the Lightning entry wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/LightningEntryPage.tsx');
  const css = read('src/pages/LightningEntryPage.css');

  it('every state sits in the arena root under the chrome mast; the card keeps its own art', () => {
    expect(page).toContain('className="arena-workspace lightning-entry-page"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('className="arena-case arena-ops-case lightning-entry__case"');
    expect(page).toContain('className="arena-switch arena-ops-keys arena-ops-primary"');
    expect(page).toContain('<LightningCashEntryCard');
    expect(page).not.toContain('<EmptyState');
    expect(page).not.toContain('SpadeConsole');
    // The route hook stays on one inner element, outside the mast.
    expect(page.match(/\n\s+data-testid="lightning-entry"\n/g) ?? []).toHaveLength(1);
  });

  it('every rule in the page sheet sits under the page arena root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(3);
    for (const s of all) expect(s.startsWith('.arena-workspace.lightning-entry-page')).toBe(true);
    ownsNoNewDress(css);
  });
});
