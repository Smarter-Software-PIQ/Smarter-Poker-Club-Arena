/**
 * The Agent Team Hierarchy and Payouts bodies wear #SmarterDesign (batch 6,
 * 2026-11-28). Their dress applies only inside .arena-workspace, and the
 * shared AgentCashoutPanel only where a page opts in with `arena`: the
 * Cashier's dialog and the player record keep the painted console. None of
 * these sheets restates the workspace's gradients or draws a radius, shadow or
 * hover of its own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS: Array<[string, RegExp]> = [
  ['src/components/agent/AgentCashoutArena.css', /^\.arena-workspace \.acp--arena\s/],
  ['src/components/agent/AgentAssignmentPanel.css', /^\.arena-workspace\s/],
  ['src/components/agent/AgentTree.module.css', /^:global\(\.arena-workspace\)\s/],
];

function selectors(sheet: string): string[] {
  return [...sheet.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@'))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

describe('the Agent Team tab bodies arena dress', () => {
  it.each(SHEETS)('%s scopes every selector', (path, scope) => {
    const found = selectors(css(path));
    expect(found.length).toBeGreaterThan(10);
    for (const selector of found) expect(selector, selector).toMatch(scope);
  });

  it.each(SHEETS)('%s draws no gradient, radius, shadow or hover of its own', (path) => {
    const sheet = css(path);
    expect(sheet).not.toMatch(/gradient\(/);
    expect(sheet).not.toMatch(/:hover/);
    expect(sheet).not.toMatch(/border-radius/);
    expect(sheet).not.toMatch(/text-transform:\s*uppercase/);
    expect(
      [...sheet.matchAll(/box-shadow\s*:\s*([^;]+)/g)].every((m) => m[1].trim() === 'none')
    ).toBe(true);
  });

  it('only Agent Team opts the shared cashout panel into the arena case', () => {
    expect(read('src/pages/AgentManagementPage.tsx')).toContain(
      '<AgentCashoutPanel clubId={clubId} arena />'
    );
    for (const page of ['src/pages/CashierTradePage.tsx', 'src/pages/MemberManagementPage.tsx']) {
      const source = read(page);
      const tag = source.slice(source.indexOf('<AgentCashoutPanel'));
      expect(tag.slice(0, tag.indexOf('/>')), page).not.toMatch(/\barena\b/);
    }
  });

  it('the console keeps its layout around the arena key wrapper', () => {
    expect(css('src/components/agent/AgentCashoutPanel.css')).toMatch(
      /\.acp-keys\s*\{\s*display:\s*contents;\s*\}/
    );
  });
});
