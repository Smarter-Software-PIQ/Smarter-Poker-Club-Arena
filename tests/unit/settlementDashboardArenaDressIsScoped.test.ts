/**
 * THE SETTLEMENT CENTER'S #SmarterDesign DRESS STAYS INSIDE ITS WORKSPACE
 * (batch S1, 2026-11-28)
 *
 * TransactionLedgerView and FinancialAdminScopeState are shared: Union
 * Operations, the Agent Dashboard, Financials, Settlement History and Credit
 * Admin mount them on their own looks. The Settlement Center (and, since batch
 * A2, the Agent Portal's ledger) opts in with `arena`. Every rule of the three new sheets must apply only
 * inside .arena-workspace, the ledger's arena rules must key on arena-only
 * classes, no sheet may draw its own gradient, shadow, radius or hover, and no
 * other host may be switched to the arena dress by accident.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS = [
  'src/pages/SettlementDashboardPage.css',
  'src/components/common/TransactionLedgerArena.css',
  'src/components/common/FinancialAdminScopeArena.css',
] as const;

function selectors(css: string): string[] {
  return [...strip(css).matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

describe('the Settlement Center arena dress', () => {
  it.each(SHEETS)('%s scopes every selector under .arena-workspace', (sheet) => {
    const all = selectors(read(sheet));
    expect(all.length).toBeGreaterThan(3);
    for (const selector of all) expect(selector, selector).toMatch(/^\.arena-workspace[\s.]/);
  });

  it.each(SHEETS)('%s draws no gradient, shadow, radius or hover of its own', (sheet) => {
    const css = strip(read(sheet));
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/:hover/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/border-radius/);
  });

  it('keys every ledger arena rule on an arena-only class', () => {
    for (const selector of selectors(read('src/components/common/TransactionLedgerArena.css')))
      expect(selector, selector).toMatch(/tlv--arena|tlv-state--arena/);
  });

  it('keeps the painted ledger and scope state as the default', () => {
    const ledger = read('src/components/common/TransactionLedgerView.tsx');
    expect(ledger).toContain('arena = false,');
    expect(ledger).toContain(
      '<button type="button" onClick={() => loadLedger()} className="tlv-word sc-ink--white">'
    );
    const state = read('src/components/common/FinancialAdminScopeState.tsx');
    expect(state).toContain('arena = false,');
    expect(state).toContain("family={failed ? 'riveted' : denied ? 'shark' : 'spade'}");
  });

  it('switches only the arena workspace pages to the arena dress', () => {
    for (const host of [
      'src/pages/UnionDashboardPage.tsx',
      'src/pages/AgentDashboardPage.tsx',
      'src/pages/ClubFinancialsPage.tsx',
    ])
      expect(read(host), host).not.toMatch(/<TransactionLedgerView[^>]*\barena\b/);
    for (const host of ['src/pages/SettlementHistoryPage.tsx', 'src/pages/CreditAdminPanel.tsx'])
      expect(read(host), host).not.toMatch(/<FinancialAdminScopeState[^>]*\barena\b/);
    const page = read('src/pages/SettlementDashboardPage.tsx');
    expect(page).toContain('<FinancialAdminScopeState scope={scope} arena />');
    expect(page.match(/<TransactionLedgerView[^>]*\barena\b/g)?.length).toBe(2);
    // The Agent Portal joined the workspace in batch A2 (2026-11-28).
    const portal = read('src/pages/AgentPortalPage.tsx');
    expect(portal).toContain('className="agent-portal arena-workspace"');
    expect(portal.match(/<TransactionLedgerView[^>]*\barena\b/g)?.length).toBe(1);
  });
});
