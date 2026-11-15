/**
 * The production Cashier Statements certificate reads figures with the grammar
 * in tests/e2e/support/exact-figure.ts. That grammar must accept what exactChips
 * prints and refuse an abbreviated figure, which would now be a regression of
 * the owner's 2026-11-13 ruling (real figures are never rounded or abbreviated).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exactChips } from '../src/utils/format';
import {
  ENTRY_PILL,
  EXACT_FIGURE,
  inexactFigures,
  sameStatementQuery,
  statementTotalsFigures,
} from './e2e/support/exact-figure';

describe('the statements certificate reads exact figures', () => {
  const values = [0, 7, 2111, 177488.28, 1234567.5, 0.01, 1e9, -12.5, -177488.28];

  it('accepts every figure exactChips prints', () => {
    for (const value of values) expect(exactChips(value), String(value)).toMatch(EXACT_FIGURE);
  });

  it('accepts the figures of the failed run, 0 | 0 | 177,488.28 | 2,111', () => {
    for (const figure of ['0', '0', '177,488.28', '2,111']) expect(figure).toMatch(EXACT_FIGURE);
  });

  it('refuses abbreviated or malformed figures', () => {
    for (const figure of ['177.5K', '1.5M', '393K', '2B', '1,23', '12,3456', '', 'Calculating'])
      expect(figure).not.toMatch(EXACT_FIGURE);
  });

  it('reads the entry pill as the page writes it', () => {
    expect(`${exactChips(1)} Entry`).toMatch(ENTRY_PILL);
    expect(`${exactChips(2111)} Entries `).toMatch(ENTRY_PILL);
    expect('Live Ledger').toMatch(ENTRY_PILL);
    expect('2.1K Entries').not.toMatch(ENTRY_PILL);
  });

  it("the figure guard names inexact figures and passes the failed run's row amounts", () => {
    expect(inexactFigures(['+1.50', '-76.26', ' 1,145.65 ', '0', exactChips(177488.28)])).toEqual(
      []
    );
    expect(inexactFigures(['+1.5K', '393K', '2B', '12.5M', '1,145.65'])).toEqual([
      '+1.5K',
      '393K',
      '2B',
      '12.5M',
    ]);
  });

  it('the certificate reads figure nodes only, so references and names never trip it', () => {
    // Review B1: these are on the Statements page beside the figures.
    const spec = readFileSync('tests/e2e/production-cashier-statements.spec.ts', 'utf8');
    const support = readFileSync('tests/e2e/support/cashierProductionCertification.ts', 'utf8');
    expect(spec).not.toMatch(/expectExactCashierFigures\(\s*surface\s*,/);
    expect(support).not.toContain('ABBREVIATED_FIGURE');
    expect(spec).toContain('button[aria-expanded] > span:last-child');
    // And it counts them: an empty locator must not pass (post-merge review note 1).
    expect(support).toMatch(/toContain\(texts\.length\)/);
    expect(spec).toContain('[0, 4]');
    // Were such text ever handed in as a figure, it is refused, not skipped.
    expect(
      inexactFigures(['Ref 262B2E2F', 'Ref 6B6424ED', 'Ref 1234567B', 'To 100K'])
    ).toHaveLength(4);
  });

  it('writes the server totals the way the Statements page writes them', () => {
    // The failed run's page: 0 | 0 | 177,488.28 | 2,111.
    expect(
      statementTotalsFigures(
        { in: '0', out: '0.00', managed: '177488.28', count: 2111 },
        exactChips
      )
    ).toEqual(['0', '0', '177,488.28', '2,111']);
    expect(
      statementTotalsFigures({ in: 1500.5, out: '76.26', managed: 0, count: '3' }, exactChips)
    ).toEqual(['+1,500.50', '-76.26', '0', '3']);
    // And the page really writes them so: the same expressions, in source.
    const page = readFileSync('src/pages/CashierStatementsPage.tsx', 'utf8');
    for (const line of [
      "`${isZero(list.totals.in) ? '' : '+'}${chips(list.totals.in)}`",
      "`${isZero(list.totals.out) ? '' : '-'}${chips(list.totals.out)}`",
      'list.totals ? chips(list.totals.managed)',
      "list.totals.count.toLocaleString('en-US')",
    ])
      expect(page, line).toContain(line);
    expect(page).toContain('const isZero = (value: string) => !/[1-9]/.test(value);');
    // The page's chips() is compactChips, and compactChips is exactChips: the
    // formatter this certificate hands the helper (review of 41b4bda8, N2).
    expect(page).toMatch(
      /function chips\(value: string\): string \{\s*return compactChips\(Number\(value\)\);\s*\}/
    );
    expect(readFileSync('src/utils/format.ts', 'utf8')).toContain(
      'export const compactChips = (n: FigureInput): string => exactChips(n);'
    );
    const spec = readFileSync('tests/e2e/production-cashier-statements.spec.ts', 'utf8');
    expect(spec).toContain("'Statement Totals on the glass differ from the server'");
  });

  it('accepts totals only for the same club, period and filters as the page', () => {
    const page = {
      p_club_id: 'c',
      p_from: '2026-11-01',
      p_kind: null,
      p_cursor: null,
      p_limit: 50,
    };
    expect(sameStatementQuery({ p_kind: null, p_from: '2026-11-01', p_club_id: 'c' }, page)).toBe(
      true
    );
    expect(sameStatementQuery({ p_club_id: 'c', p_from: '2026-10-01', p_kind: null }, page)).toBe(
      false
    );
    expect(sameStatementQuery({ p_club_id: 'd', p_from: '2026-11-01', p_kind: null }, page)).toBe(
      false
    );
    expect(sameStatementQuery({ p_club_id: 'c', p_from: '2026-11-01' }, page)).toBe(false);
    expect(sameStatementQuery(null, page)).toBe(false);
    expect(sameStatementQuery({}, {})).toBe(false);
    // The application sends both requests the same arguments, paging apart.
    const hook = readFileSync('src/hooks/useCashierStatement.ts', 'utf8');
    expect(hook).toContain("supabase.rpc('fn_cashier_statement_totals', pageArgs)");
    expect(hook).toMatch(
      /supabase\.rpc\('fn_cashier_statement_page', \{\s*\.\.\.pageArgs,\s*p_cursor: null,\s*p_limit: STATEMENT_PAGE_SIZE,\s*\}\)/
    );
  });

  it('cannot pass on a refusal in the certification run, and compares before it passes', () => {
    const spec = readFileSync('tests/e2e/production-cashier-statements.spec.ts', 'utf8');
    expect(spec).toMatch(
      /if \(process\.env\.E2E_REQUIRE_AUTH === '1'\)\s*expect\(authorized, [^)]*\)\.toBe\(\s*true\s*\);/
    );
    expect(spec.indexOf("process.env.E2E_REQUIRE_AUTH === '1'")).toBeLessThan(
      spec.indexOf('if (authorized) {')
    );
    for (const line of [
      'sameStatementQuery(newest.asked, response.request().postDataJSON())',
      'statementTotalsFigures(served, exactChips)',
      'figures.length === 4 && differing.length === 0',
      ".toBe('matches the server');",
    ])
      expect(spec, line).toContain(line);
    // The step that runs this certificate sets the flag.
    const workflow = readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8');
    const run = workflow.indexOf(
      'npx playwright test tests/e2e/production-cashier-statements.spec.ts'
    );
    const env = workflow.lastIndexOf('env:', run);
    expect(run).toBeGreaterThan(-1);
    expect(workflow.slice(env, run)).toContain("E2E_REQUIRE_AUTH: '1'");
    expect(workflow.slice(env, run)).not.toMatch(/\n {6}- name:/);
  });
});
