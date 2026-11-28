/**
 * THE CLUB OPERATIONS PAGES STAY IN #SMARTERDESIGN (Dan 2026-11-27).
 *
 * Dan ordered the Club Operations bar and every page it opens upgraded to
 * #SmarterDesign, and rejected a pass built from the painted console plates:
 * "THAT IS NOT THE #SMARTERDESIGN. WTF?!" and "DO NOT USE THOSE BULKY FRAMES,
 * THATS THE OLD STYLE". The rebuild shipped in PR #12262. This law keeps it from
 * sliding back: each page renders on the arena workspace with the shared mast,
 * none of them brings back the painted plates, and the rail keeps its gold
 * numbers instead of the banned brown badge box.
 *
 * Adding a page to Club Operations? Add it to PAGES. The standard is
 * .claude/skills/smarter-design/SKILL.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every page the Club Operations rail opens, by the file that renders it. */
const PAGES: Record<string, string> = {
  Overview: 'src/pages/club/ClubOperationsPage.tsx',
  Dashboard: 'src/pages/club/ClubDashboard.tsx',
  Players: 'src/pages/ClubMembersPage.tsx',
  Reports: 'src/pages/ReportReviewPage.tsx',
  'Hand Review': 'src/pages/ClubHandReviewPage.tsx',
  'Finance Overview And Control Overview': 'src/pages/workspaces/ArenaWorkspacePages.tsx',
  'Club Data': 'src/pages/club/ClubDataSimplePage.tsx',
  Settings: 'src/pages/ClubSettingsPage.tsx',
  // The tool pages the Overview opens (Dan 2026-11-27: "EVERY SINGLE ONE OF THESE PAGES").
  Applicants: 'src/pages/ClubApplicantsPage.tsx',
  'Agent Team': 'src/pages/AgentManagementPage.tsx',
  'Agent Network': 'src/pages/SuperAgentDashboard.tsx',
  'Anti-Cheat': 'src/pages/AntiCheatPage.tsx',
  Disputes: 'src/pages/DisputeManagementPage.tsx',
  Blacklist: 'src/pages/BlacklistManagerPage.tsx',
  Financials: 'src/pages/ClubFinancialsPage.tsx',
  'Diamond Wheel': 'src/pages/club/ClubWheelOperationsPage.tsx',
  'Diamond Games': 'src/pages/club/ClubDiamondGamesOperationsPage.tsx',
  'Diamond Costs': 'src/pages/club/ClubDiamondCostsPage.tsx',
  Settlement: 'src/pages/SettlementPage.tsx',
  'Insurance Report': 'src/pages/club/ClubInsuranceReportPage.tsx',
  'Bomb Pot Report': 'src/pages/club/ClubBombPotReportPage.tsx',
  Announcements: 'src/pages/ClubAnnouncementsPage.tsx',
  'Player Offers': 'src/pages/PromotionsPage.tsx',
  'Promo Vault': 'src/pages/PromoVaultPage.tsx',
  'Table Management': 'src/pages/GameManagementPage.tsx',
  Lightning: 'src/pages/club/ClubLightningOperationsPage.tsx',
  'Club Rules': 'src/pages/ClubRulesPage.tsx',
};

/** The old painted-console style, by the names it is imported or written with. */
const PAINTED = [
  /from ['"][./]*(?:\.\.\/)*components\/console\/SpadeConsole['"]/,
  /from ['"]\.\/SpadeConsole['"]/,
  /\bsc-plate\b/,
  /ops-console-v1/,
  /club-nav-shell/,
];

describe('the Club Operations pages stay in #SmarterDesign', () => {
  for (const [name, file] of Object.entries(PAGES)) {
    describe(name, () => {
      it('exists', () => {
        expect(existsSync(join(ROOT, file)), `${file} moved: update PAGES`).toBe(true);
      });

      it('renders on the arena workspace with the shared mast', () => {
        const src = read(file);
        expect(src, `${file} lost the arena-workspace root`).toMatch(
          /['"`\s]arena-workspace['"`\s]/
        );
        // Players and Club Data mount the mast through their own header pieces.
        const mast =
          /<ArenaWorkspaceHeader\b/.test(src) ||
          /<ClubIntegrityHeader\b/.test(src) ||
          /arena-workspace-mast|RosterRecords|ArenaWorkspaceHeader/.test(src);
        expect(mast, `${file} lost the #SmarterDesign mast`).toBe(true);
      });

      it('does not bring back the painted console plates', () => {
        const src = read(file);
        for (const re of PAINTED) expect(src, `${file} matches ${re}`).not.toMatch(re);
      });
    });
  }

  it('the rail keeps gold numbers, never the brown badge box', () => {
    const css = read('src/components/navigation/ClubOperationsRail.module.css');
    expect(css).toMatch(/#ffd700/i);
    expect(css).not.toMatch(/rgba\(\s*120\s*,\s*74\s*,\s*24/);
    expect(css).toMatch(/chrome-case\.webp/);
  });

  it('the standard is written down where every agent looks', () => {
    expect(existsSync(join(ROOT, '.claude/skills/smarter-design/SKILL.md'))).toBe(true);
    const claude = read('CLAUDE.md');
    expect(claude).toContain('.claude/skills/smarter-design/SKILL.md');
    expect(claude).toContain('THAT IS NOT THE #SMARTERDESIGN');
  });
});
