import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('financial admin subpages keep the Club Arena console contract', () => {
  it('keeps the Financial Admin union surface off the shark family empty plate', () => {
    const page = read('src/pages/FinancialAdminHub.tsx');

    expect(page).not.toContain('family="shark"');
    expect(page).toContain("clubPath: 'financials'");
    expect(page).not.toContain("label: 'Settlements'");
  });

  it('renders Credit Admin in the arena workspace without generic card chrome (#SmarterDesign O2)', () => {
    const page = read('src/pages/CreditAdminPanel.tsx');
    const pageCss = read('src/pages/CreditAdminPanel.css');
    const requestCss = read('src/components/agent/CreditRequestWidget.css');

    // Dan, 2026-11-27: the painted spade console is the old style on a page.
    expect(page).not.toContain('SpadeConsole');
    expect(page).toContain('className="credit-admin-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('area="finance"');
    expect(page).toContain('const hasExport = dataReady && agents.length > 0');
    // Export Shown Rows is the one lit key, and only when rows are shown.
    expect(page).toMatch(
      /\{hasExport && \(\s*<div className="arena-switch arena-ops-keys arena-ops-primary[^"]*">\s*<button type="button" onClick=\{exportShownRows\}>\s*Export Shown Rows/
    );
    // Back is a chrome key above the mast, never inside it.
    for (const at of [...page.matchAll(/<ArenaWorkspaceHeader/g)].map((m) => m.index ?? 0))
      expect(page.lastIndexOf('Back', at)).toBeGreaterThan(page.lastIndexOf('<main', at));
    expect(page).toContain('{titleCase(agent.clubName)}');
    expect(page).toContain('{titleCase(log.clubName)}');
    expect(page).not.toContain('PageSkeleton');
    expect(page).not.toMatch(/style=\{\{/);
    expect(page).not.toMatch(/[✓✕←→]/);
    // The chrome comes from the workspace's variables, never a new gradient,
    // radius or blur written here.
    for (const css of [pageCss, requestCss]) {
      expect(css).not.toMatch(/border-radius\s*:/);
      expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/);
      expect(css).not.toMatch(/backdrop-filter\s*:/);
    }
    expect(pageCss).toContain('@media (max-width: 480px)');
    expect(requestCss).toContain('@media (max-width: 480px)');
  });

  it('uses one scope console instead of nesting painted frames and keeps loading plate-free', () => {
    const scopeState = read('src/components/common/FinancialAdminScopeState.tsx');
    const credit = read('src/pages/CreditAdminPanel.tsx');
    const settlement = read('src/pages/SettlementDashboardPage.tsx');

    expect(scopeState).toContain("family={failed ? 'riveted' : denied ? 'shark' : 'spade'}");
    expect(scopeState).toContain("foot={failed || denied ? 'plates' : 'foot'}");
    expect(credit).toContain("if (scope.status !== 'ready') {");
    // Credit Admin is an arena workspace page (batch O2); since batch A2 its
    // scope states take the opt-in arena dress too.
    expect(credit).toContain('return <FinancialAdminScopeState scope={scope} arena />;');
    expect(credit).not.toMatch(/<SpadeConsole[\s\S]{0,900}<FinancialAdminScopeState/);
    // The Settlement Center is an arena workspace page (#SmarterDesign batch
    // S1, 2026-11-28): its scope states take the opt-in arena dress.
    expect(settlement).toContain(
      "if (scope.status !== 'ready') return <FinancialAdminScopeState scope={scope} arena />;"
    );
    expect(settlement).not.toMatch(/<SpadeConsole[\s\S]{0,500}<FinancialAdminScopeState/);
  });

  it('renders weekly accounting and its retained ledger in the arena workspace (#SmarterDesign S1)', () => {
    const page = read('src/pages/SettlementDashboardPage.tsx');

    // Dan, 2026-11-27: the painted spade console is the old style on a page.
    expect(page).not.toContain('SpadeConsole');
    expect(page).toContain('className="settlement-dashboard-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('area="finance"');
    expect(page.match(/className="arena-case arena-ops-case/g)?.length).toBe(3);
    expect(page).toContain(
      "const ledgerTitle = scopeClubId ? 'Club Transaction Records' : 'Your Account Transactions';"
    );
    expect(page).toContain('aria-label={ledgerTitle}');
    // One region carries the ledger's name: the case, never the list inside it.
    expect(page.match(/aria-label=\{ledgerTitle\}/g)?.length).toBe(1);
    expect(page).not.toMatch(/<TransactionLedgerView[^>]*title=\{ledgerTitle\}/);
    // The ledger takes the opt-in arena dress on both scopes.
    expect(page.match(/<TransactionLedgerView[^>]*\barena\b/g)?.length).toBe(2);
    // Back is a chrome key above the mast, never inside it.
    expect(page.indexOf('Back')).toBeLessThan(
      page.indexOf('<ArenaWorkspaceHeader', page.indexOf('const ledgerTitle'))
    );
    expect(page).not.toMatch(/style=\{\{/);
  });

  it('wraps ledger copy on phones and never restores the clipped one-line layout', () => {
    const css = read('src/components/common/TransactionLedgerView.css');

    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/\.tlv-path,[\s\S]{0,180}?overflow:\s*hidden/);
    expect(css).not.toMatch(/\.tlv-description[\s\S]{0,180}?white-space:\s*nowrap/);
  });
});
