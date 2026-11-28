/**
 * THE ROUTED TOURNAMENT PAGE WEARS THE WORKSPACE MAST, AND ITS DRESS STAYS ON
 * THE PAGE (#SmarterDesign batch T1, 2026-11-28)
 *
 * The routed /tournaments/:id page opens on the ArenaWorkspaceHeader mast and
 * prints its empty, error and loading states on the workspace kit. The same
 * page is also the in-game popup and the lobby tab, which keep the event band
 * alone (Dan, 2026-10-04: "remove all these large frames"). Every new rule is
 * scoped under the page root, and the mast never eats the tab panel on a
 * short screen (tests/e2e/css/tournamentLobbyTabPanelHeightCases.ts).
 * Figures, words and controls are pinned in
 * tests/components/tournamentDetailsPageIsPinned.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const DETAILS = read('src/pages/tournament/TournamentDetails.tsx');
const PAGE_SHEET = stripComments(read('src/pages/tournament/TournamentDetailsArena.css'));
const GATE = read('src/components/tournament/TournamentClubJoinGate.tsx');
const GATE_SHEET = stripComments(read('src/components/tournament/TournamentClubJoinGate.css'));

function selectors(css: string): string[] {
  const out: string[] = [];
  // Strip @media wrappers: keep the rules inside them.
  const flat = css.replace(/@media[^{]*\{/g, '');
  for (const block of flat.split('}')) {
    const head = block.split('{')[0].trim();
    if (!head) continue;
    for (const sel of head.split(',')) out.push(sel.replace(/\s+/g, ' ').trim());
  }
  return out.filter(Boolean);
}

describe('the routed tournament page wears the workspace mast', () => {
  it('draws the ArenaWorkspaceHeader mast on the route only, and never over the event band', () => {
    expect(DETAILS).toContain(
      "import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';"
    );
    expect(DETAILS).toMatch(
      /const mast =\s*isEmbedded \|\| onClose \? null : \(\s*<ArenaWorkspaceHeader/
    );
    expect(DETAILS).toMatch(/title="Tournament Lobby"/);
    // Only where no event band heads the page: loading, failed, not found and
    // the join step. The ready lobby is headed by its event band alone.
    expect(DETAILS.match(/\{mast\}/g)?.length).toBe(4);
    expect(DETAILS).toMatch(/data-lobby-tab=\{inLobbyTab\}\s*>\s*\{recoveryNotice\}/);
  });

  it('prints the empty states on a chrome case and the join step without the painted console', () => {
    expect(DETAILS).toMatch(
      /<div className="arena-case arena-ops-case tournament-details__state">\s*<h2 className="arena-section-title">Tournament Not Found<\/h2>/
    );
    expect(GATE).not.toMatch(/SpadeConsole|sc-copy|PlateButton/);
    expect(GATE).toMatch(/className="tournament-club-join-gate arena-case arena-ops-case"/);
    expect(GATE).toMatch(/className="arena-section-title"/);
    expect(GATE).toMatch(/className="arena-switch arena-ops-keys tournament-club-join-gate__keys"/);
  });

  it('every new page rule starts at the page root', () => {
    const sels = selectors(PAGE_SHEET);
    expect(sels.length).toBeGreaterThan(10);
    for (const sel of sels)
      expect(sel.startsWith('.tournament-details.arena-workspace')).toBe(true);
  });

  it('every join step rule starts at the workspace root', () => {
    const sels = selectors(GATE_SHEET);
    expect(sels.length).toBeGreaterThan(4);
    for (const sel of sels) expect(sel.startsWith('.arena-workspace ')).toBe(true);
  });

  it('adds no hover, no !important, no art and no rounded corner', () => {
    for (const css of [PAGE_SHEET, GATE_SHEET]) {
      expect(css).not.toMatch(/:hover/);
      expect(css).not.toMatch(/!important/);
      expect(css).not.toMatch(/url\(/);
      expect(css).not.toMatch(/border-radius/);
    }
  });

  it('the mast is a slim fixed band that steps aside on a short screen', () => {
    expect(PAGE_SHEET).toMatch(
      /\.tournament-details\.arena-workspace > \.arena-workspace-mast \{[^}]*flex: 0 0 auto;[^}]*min-height: 56px;/
    );
    expect(PAGE_SHEET).toMatch(
      /@media \(max-height: 760px\) \{\s*\.tournament-details\.arena-workspace > \.arena-workspace-mast \{\s*display: none;/
    );
  });
});
