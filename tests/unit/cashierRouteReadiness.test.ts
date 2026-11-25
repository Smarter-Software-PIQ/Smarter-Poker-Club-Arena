import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tests/e2e/routes/club-operations-exhaustive.spec.ts', 'utf8');

describe('Cashier route readiness before action navigation certification', () => {
  const cashierStart = source.indexOf("} else if (operation.id === 'cashier') {");
  const caseBudget = source.indexOf("if (operation.id === 'cashier') test.setTimeout(120_000)");
  const end = source.indexOf('operation.marker', cashierStart);
  const branch = source.slice(cashierStart, end);

  it('waits for the positive Cashier surface before testing its tools and shared navigation', () => {
    expect(caseBudget).toBeGreaterThan(-1);
    expect(caseBudget).toBeLessThan(cashierStart);
    const ready = branch.indexOf(
      `await expect(page.locator('[data-cashier-mode="simple"]')).toBeVisible({ timeout: 30_000 })`
    );
    const tools = branch.indexOf('name: /^Requests, Tickets And Tools/');
    const tablist = branch.indexOf("getByRole('tablist', { name: 'Cashier Actions' })");
    const navigation = branch.indexOf("name: 'Club Operations Sections'");
    expect(ready).toBeGreaterThan(-1);
    expect(tools).toBeGreaterThan(ready);
    expect(tablist).toBeGreaterThan(tools);
    expect(navigation).toBeGreaterThan(tablist);
  });

  it('still refuses a missing cashier marker and retains content and permission checks', () => {
    expect(branch).not.toMatch(/catch|test\.skip|waitForTimeout|isVisible\(/);
    expect(source).toContain('This Surface Could Not Load');
    expect(source).toContain('This Tool Is Restricted');
    expect(source).toContain('Club Operations Is Restricted');
    expect(source).toContain('Financials Are Restricted');
  });
});
