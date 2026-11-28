/**
 * The Agent Team Commissions and Players bodies wear #SmarterDesign (batch 7,
 * 2026-11-28). Their dress applies only inside .arena-workspace, so each
 * component's old sheet still dresses it anywhere else. None of these sheets
 * restates the workspace's gradients or draws a radius, shadow, hover or
 * shouting case of its own: a radius or shadow may only be taken away
 * (`0` / `none`) from the old rounded card underneath.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS: Array<[sheet: string, component: string]> = [
  [
    'src/components/agent/AgentCommissionArena.css',
    'src/components/agent/AgentCommissionDashboard.tsx',
  ],
  ['src/components/admin/PlayerSearchArena.css', 'src/components/admin/PlayerSearch.tsx'],
  [
    'src/components/agent/DistributionHistoryArena.css',
    'src/components/agent/DistributionHistory.tsx',
  ],
  [
    'src/components/agent/AgentAnalyticsArena.css',
    'src/components/agent/AgentAnalyticsDashboard.tsx',
  ],
];

function selectors(sheet: string): string[] {
  return [...sheet.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@'))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

const values = (sheet: string, property: string) =>
  [...sheet.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, 'g'))].map((m) =>
    m[1].trim()
  );

describe('the Agent Team Commissions and Players arena dress', () => {
  it.each(SHEETS)('%s scopes every selector under .arena-workspace', (path) => {
    const found = selectors(css(path));
    expect(found.length).toBeGreaterThan(10);
    for (const selector of found) expect(selector, selector).toMatch(/^\.arena-workspace[\s.]/);
  });

  it.each(SHEETS)('%s draws no gradient, radius, shadow, hover or upper case', (path) => {
    const sheet = css(path);
    expect(sheet).not.toMatch(/gradient\(/);
    expect(sheet).not.toMatch(/:hover/);
    expect(sheet).not.toMatch(/uppercase/);
    expect(values(sheet, 'border-radius').every((v) => v === '0')).toBe(true);
    expect(values(sheet, 'box-shadow').every((v) => v === 'none')).toBe(true);
  });

  it.each(SHEETS)('%s is imported by its component', (path, component) => {
    const name = path.split('/').pop();
    expect(read(component)).toContain(`import './${name}';`);
  });

  it('the Agent Team page is the arena workspace those bodies render in', () => {
    const page = read('src/pages/AgentManagementPage.tsx');
    expect(page).toContain('className={`arena-workspace ${styles.page}`}');
    for (const body of [
      '<AgentCommissionDashboard clubId={clubId} />',
      '<PlayerSearch',
      '<DistributionHistory userId={user.id} clubId={clubId} />',
      '<AgentAnalyticsDashboard userId={user.id} clubId={clubId} />',
    ])
      expect(page).toContain(body);
  });
});
