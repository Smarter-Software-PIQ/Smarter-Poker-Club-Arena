/**
 * THE P7 PLAYER PAGES' ARENA DRESS IS SCOPED TO EACH PAGE
 * (#SmarterDesign player pages batch P7, 2026-11-28)
 *
 * /profile/:userId, /report/:playerId, /i/:code and the 404 route wear the
 * arena workspace. PublicProfilePage keeps its CSS module with every rule
 * under .publicProfilePage and no bare global class names; ReportPlayerPage
 * leaves SpadeConsole for an arena case; InviteCodePage gets its own scoped
 * sheet so InvitePage.css stays untouched for InvitePage; NotFoundPage wraps
 * ArenaEmptyState in an arena-workspace shell with ArenaWorkspaceHeader so
 * EmptyState.tsx stays untouched for non-arena hosts.
 */
import { readFileSync } from 'node:fs';
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

describe('PublicProfilePage wears the arena workspace, inside its own module', () => {
  const page = read('src/pages/PublicProfilePage.tsx');
  const css = read('src/pages/PublicProfilePage.module.css');

  it('carries the arena root, chrome mast, cases, meters and switch without bare globals', () => {
    expect(page.match(/`\$\{styles\.publicProfilePage\} arena-workspace`/g)).toHaveLength(3);
    expect(page.match(/<ArenaWorkspaceHeader/g)).toHaveLength(3);
    expect(page).toContain('`${styles.publicProfileHeader} arena-case arena-ops-case`');
    expect(page).toContain('`${styles.recordCell} arena-meter`');
    expect(page).toContain('`${styles.profileActions} arena-switch arena-ops-keys`');
    expect(page).not.toMatch(/className="/);
    expect(page).not.toContain('SpadeConsole');
  });

  it('every rule in the module sits under .publicProfilePage, and none is global', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(25);
    for (const s of all)
      expect(s === '.publicProfilePage' || s.startsWith('.publicProfilePage ')).toBe(true);
    expect(css).not.toContain(':global');
  });
});

describe('ReportPlayerPage wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/ReportPlayerPage.tsx');
  const css = read('src/pages/ReportPlayerPage.css');

  it('leaves SpadeConsole for the arena root, chrome mast, case, switch and dark wells', () => {
    expect(page.match(/className="report-page arena-workspace"/g)).toHaveLength(2);
    expect(page.match(/<ArenaWorkspaceHeader/g)).toHaveLength(2);
    expect(page).toContain('className="arena-case arena-ops-case report-page__case"');
    expect(page).toContain('className="arena-switch arena-ops-keys report-page__reasons"');
    expect(page).toContain('className="arena-ledger-row report-page__check-row"');
    expect(page).not.toContain('SpadeConsole');
  });

  it('every rule in the page sheet sits under .report-page.arena-workspace', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) expect(s.startsWith('.report-page.arena-workspace')).toBe(true);
  });
});

describe('InviteCodePage wears the arena workspace without touching InvitePage.css', () => {
  const page = read('src/pages/InviteCodePage.tsx');
  const css = read('src/pages/InviteCodePage.css');

  it('carries the arena root, chrome mast and case, and no longer imports InvitePage.css', () => {
    expect(page.match(/className="invite-code-page arena-workspace"/g)).toHaveLength(2);
    expect(page.match(/<ArenaWorkspaceHeader/g)).toHaveLength(2);
    expect(page).toContain('className="arena-case arena-ops-case invite-code-page__case"');
    expect(page).toContain("import './InviteCodePage.css';");
    expect(page).not.toContain("import './InvitePage.css';");
  });

  it('every rule in InviteCodePage.css sits under .invite-code-page.arena-workspace', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(3);
    for (const s of all) expect(s.startsWith('.invite-code-page.arena-workspace')).toBe(true);
  });

  it('leaves InvitePage.css free of arena rules', () => {
    expect(read('src/pages/InvitePage.css')).not.toContain('arena-workspace');
  });
});

describe('NotFoundPage wears the arena workspace with ArenaEmptyState', () => {
  const page = read('src/pages/NotFoundPage.tsx');
  const css = read('src/pages/NotFoundPage.css');

  it('carries the arena root, chrome mast, case and ArenaEmptyState', () => {
    expect(page).toContain('className="arena-workspace not-found-page"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('<ArenaEmptyState');
    expect(page).not.toContain("from '../components/common/EmptyState'");
  });

  it('every rule in NotFoundPage.css sits under .not-found-page.arena-workspace', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(1);
    for (const s of all) expect(s.startsWith('.not-found-page.arena-workspace')).toBe(true);
  });
});
