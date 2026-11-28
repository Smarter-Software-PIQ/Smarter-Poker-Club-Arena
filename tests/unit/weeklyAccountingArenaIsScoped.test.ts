/**
 * The weekly accounting components are shared by the Settlement page (an arena
 * workspace) and by the Settlement Dashboard, Union Statements and the admin
 * dashboard (not arena workspaces). Their #SmarterDesign dress must apply only
 * inside .arena-workspace, or it would restyle those pages too, and it must not
 * restate the workspace's own gradients.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/components/accounting/WeeklyAccountingArena.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

describe('the weekly accounting arena dress', () => {
  it('scopes every selector under .arena-workspace', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => s && !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(10);
    for (const group of selectors)
      for (const selector of group.split(/,(?![^(]*\))/).map((s) => s.trim()))
        expect(selector, selector).toMatch(/^\.arena-workspace\s/);
  });

  it('draws no gradient, radius beyond square, shadow or hover of its own', () => {
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/:hover/);
    expect([...css.matchAll(/border-radius\s*:\s*([^;]+)/g)].map((m) => m[1].trim())).toEqual(
      css.includes('border-radius') ? ['0'] : []
    );
    expect(
      [...css.matchAll(/box-shadow\s*:\s*([^;]+)/g)].every((m) => m[1].trim() === 'none')
    ).toBe(true);
  });
});
