/**
 * THE AGENT PORTAL'S #SmarterDesign DRESS STAYS INSIDE ITS WORKSPACE
 * (batch A2, 2026-11-28)
 *
 * The Agent Portal and its Credit Invoices case wear the arena workspace from
 * two new sheets. Every rule must apply only inside .arena-workspace, no sheet
 * may draw its own gradient, shadow, radius or hover, the sheets load only
 * from the lazily loaded page and the panel it alone renders (so nothing
 * enters the entry chunk), and the transfer dialog keeps its painted console.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS = [
  'src/pages/AgentPortalPage.css',
  'src/components/agent/AgentInvoicesArena.css',
] as const;

function selectors(css: string): string[] {
  return [...strip(css).matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

describe('the Agent Portal arena dress', () => {
  it.each(SHEETS)('%s scopes every selector under .arena-workspace', (sheet) => {
    const all = selectors(read(sheet));
    expect(all.length).toBeGreaterThan(5);
    for (const selector of all) expect(selector, selector).toMatch(/^\.arena-workspace[\s.]/);
  });

  it.each(SHEETS)('%s draws no gradient, shadow, radius or hover of its own', (sheet) => {
    const css = strip(read(sheet));
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/:hover/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/border-radius/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });

  it('loads the sheets only from the lazy page and its one panel', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(
      /const AgentPortalPage = lazyWithRetry\(\(\) => import\('\.\/pages\/AgentPortalPage'\)\)/
    );
    expect(app).not.toMatch(/import AgentPortalPage from/);
    expect(read('src/pages/AgentPortalPage.tsx')).toContain("import './AgentPortalPage.css';");
    expect(read('src/components/agent/AgentInvoicesPanel.tsx')).toContain(
      "import './AgentInvoicesArena.css';"
    );
  });

  it('prints the page and the invoices on the arena kit, the dialog on its console', () => {
    const page = read('src/pages/AgentPortalPage.tsx');
    expect(page).toContain('className="agent-portal arena-workspace"');
    expect(page).toContain('area="finance"');
    expect(page.match(/<SpadeConsole\b/g)?.length).toBe(1);
    expect(page).toMatch(/<SpadeConsole\s+family="spade"\s+crest="flat"\s+as="div"/);
    const panel = read('src/components/agent/AgentInvoicesPanel.tsx');
    expect(panel).not.toMatch(/SpadeConsole/);
    expect(panel).toContain('className="arena-case arena-ops-case agent-invoices-arena"');
    expect(panel).toContain('className="agent-invoices-arena__row arena-ledger-row"');
  });
});
