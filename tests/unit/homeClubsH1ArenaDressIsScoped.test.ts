/**
 * #SMARTERDESIGN BATCH H1 ARENA DRESS IS SCOPED (2026-11-28)
 *
 * Pins that ClubsPage (/clubs-list), ClubDiscovery, HomePage (/), and
 * PokerArenaLandingPage (/, signed-out) wear the #SmarterDesign arena
 * workspace shell and mast without leaving painted SpadeConsole page sections
 * behind, while keeping HomePage's two modal dialogs, ClubEntryActionBar,
 * prerendered landing landmark, and stylesheet scoping intact.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const CLUBS_TSX = read('src/pages/ClubsPage.tsx');
const CLUBS_CSS = read('src/pages/ClubsPage.module.css');
const DISCOVERY_TSX = read('src/components/clubs/ClubDiscovery.tsx');
const DISCOVERY_CSS = read('src/components/clubs/ClubDiscovery.css');
const HOME_TSX = read('src/pages/HomePage.tsx');
const HOME_CSS = read('src/pages/HomePage.module.css');
const LANDING_TSX = read('src/pages/PokerArenaLandingPage.tsx');
const LANDING_CSS = read('src/pages/PokerArenaLandingPage.module.css');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('#SmarterDesign Batch H1 arena dress is scoped', () => {
  it('ClubsPage and ClubDiscovery wear arena-workspace and ArenaWorkspaceHeader with zero SpadeConsole frames', () => {
    expect(CLUBS_TSX).toContain('arena-workspace');
    expect(CLUBS_TSX).toContain('<ArenaWorkspaceHeader');
    expect(CLUBS_TSX).not.toContain('<SpadeConsole');
    expect(CLUBS_TSX).not.toContain('<PageBar');
    expect(DISCOVERY_TSX).toContain('arena-case');
    expect(DISCOVERY_TSX).not.toContain('<SpadeConsole');
  });

  it('ClubDiscovery.css scopes every rule under .club-discovery and has no :hover or drawn gradients', () => {
    const code = stripComments(DISCOVERY_CSS);
    expect(code).not.toContain(':hover');
    expect(code).not.toMatch(/linear-gradient|radial-gradient/);
    const selectors = [...code.matchAll(/(?:^|\n)([^{}@\n][^{}\n]*)\{/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) {
      for (const part of sel.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        expect(trimmed, `unscoped selector in ClubDiscovery.css: ${trimmed}`).toMatch(
          /^\.club-discovery\b/
        );
      }
    }
  });

  it('ClubsPage.module.css has no :hover, no drawn gradients, and pairs overflow-x: clip after hidden', () => {
    const code = stripComments(CLUBS_CSS);
    expect(code).not.toContain(':hover');
    expect(code).not.toMatch(/linear-gradient|radial-gradient/);
    expect(code).toMatch(/overflow-x:\s*hidden;\s*overflow-x:\s*clip;/);
  });

  it('HomePage wears arena-workspace and ArenaWorkspaceHeader, with SpadeConsole limited to its two modals', () => {
    expect(HOME_TSX).toContain('arena-workspace');
    expect(HOME_TSX).toContain('<ArenaWorkspaceHeader');
    const consoles = [...HOME_TSX.matchAll(/<SpadeConsole\b[\s\S]*?>/g)].map((m) => m[0]);
    expect(consoles).toHaveLength(2);
    for (const tag of consoles) {
      expect(tag).toContain('onClose=');
    }
    expect(stripComments(HOME_CSS)).not.toContain(':hover');
  });

  it('PokerArenaLandingPage wears arena-workspace and ArenaWorkspaceHeader, keeps its prerender main landmark, and has zero SpadeConsole frames', () => {
    expect(LANDING_TSX).toContain('<main className={styles.page} id="main-content" tabIndex={-1}>');
    expect(LANDING_TSX).toContain('arena-workspace');
    expect(LANDING_TSX).toContain('<ArenaWorkspaceHeader');
    expect(LANDING_TSX).not.toContain('<SpadeConsole');
    const code = stripComments(LANDING_CSS);
    expect(code).not.toContain(':hover');
    expect(code).not.toMatch(/linear-gradient|radial-gradient/);
  });
});
