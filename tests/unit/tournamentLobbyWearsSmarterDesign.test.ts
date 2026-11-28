/**
 * THE TOURNAMENT LOBBY WEARS #SMARTERDESIGN (2026-11-27)
 *
 * Dan, 2026-11-27: every page, sub page and button gets the #SmarterDesign
 * upgrade. For the tournament lobby (the routed /tournaments/:id page, the
 * lobby tab and the in-game TournamentLobbyModal, which all render
 * TournamentDetails) that is the arena workspace language of
 * src/components/lobby/ArenaWorkspace.css, applied by
 * src/pages/tournament/TournamentLobbySmarterDesign.css.
 *
 * Source assertions, because the skin is a stylesheet: the root must carry
 * the workspace class, the kit must be loaded, and the skin must dress the
 * lobby from the workspace's own art variables and nothing new.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const DETAILS = read('src/pages/tournament/TournamentDetails.tsx');
const SKIN = stripComments(read('src/pages/tournament/TournamentLobbySmarterDesign.css'));
/** Prettier breaks long selectors across lines; assert against one spacing. */
const FLAT = SKIN.replace(/\s+/g, ' ');
const PREFIX = '.tournament-details.arena-workspace.console-lobby.console-lobby.console-lobby';

describe('the tournament lobby wears #SmarterDesign', () => {
  it('the lobby root carries arena-workspace and loads the workspace kit then the skin', () => {
    expect(DETAILS).toMatch(/className="tournament-details console-lobby arena-workspace"/);
    expect(DETAILS).toMatch(/className="tournament-details arena-workspace loading"/);
    const kit = DETAILS.indexOf("import '../../components/lobby/ArenaWorkspace.css';");
    const skin = DETAILS.indexOf("import './TournamentLobbySmarterDesign.css';");
    expect(kit).toBeGreaterThan(-1);
    expect(skin).toBeGreaterThan(kit);
  });

  it('every skin selector is scoped to the lobby root, with no :is() list a CSS audit reads as bare', () => {
    // tests/global-css-does-not-leak-across-pages.law.test.ts splits selector
    // lists on commas, so an :is(.a, .b) list reads to it as bare `.b`.
    expect(SKIN).not.toMatch(/:is\(/);
    const selectors = SKIN.split('}')
      .map((block) => block.split('{')[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(20);
    for (const group of selectors)
      for (const sel of group.split(','))
        expect(sel.replace(/\s+/g, ' ').trim().startsWith(PREFIX)).toBe(true);
  });

  it('cases, readouts, rows and keys use the workspace art at the workspace widths', () => {
    expect(SKIN).toMatch(/border-image: var\(--arena-frame\) 41 \/ 19px stretch/);
    expect(SKIN).toMatch(/border-image: var\(--arena-stat\) 11 \/ 6px stretch/);
    expect(SKIN).toMatch(/border-image: var\(--arena-row\) 13 \/ 6px stretch/);
    expect(SKIN).toMatch(/border-image-source: var\(--arena-active\)/);
    expect(SKIN).toMatch(/border-bottom: 1px solid #253e57/);
    // The selected section and the lit primary use the workspace's blue.
    expect(FLAT).toMatch(/\.details-tabs \.tab\[aria-selected='true'\]/);
    expect(FLAT).toMatch(/\.details-tabs \.tab\.active/);
    expect(SKIN).toMatch(/linear-gradient\(#087cfa, #0044ac 55%, #002b68\)/);
  });

  it('adds no hover, no !important, no rounded corners and no raster of its own', () => {
    expect(SKIN).not.toMatch(/:hover/);
    expect(SKIN).not.toMatch(/!important/);
    expect(SKIN).not.toMatch(/url\(/);
    for (const m of SKIN.matchAll(/border-radius:\s*([^;]+);/g)) expect(m[1].trim()).toBe('0');
  });

  it('every key a player taps stays at the 44px touch floor', () => {
    expect(FLAT).toMatch(/\.details-tabs \.tab \{[^}]*min-height: 44px/);
    expect(FLAT).toMatch(/\.details-footer\s+\.btn-share \{[^}]*min-height: 44px/);
    expect(FLAT).toMatch(/\.mtt-meta-actions\s+button \{[^}]*min-height: 44px/);
  });
});
