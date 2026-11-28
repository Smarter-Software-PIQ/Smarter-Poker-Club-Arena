/**
 * THE TRANSACTION LEDGER'S ARENA DRESS IS SCOPED TO ITS PAGE (#SmarterDesign
 * player pages batch P4, 2026-11-28)
 *
 * The chip statement, the tournament payments and the rakeback week are shared
 * components. On /transactions, which wears the arena workspace, the statement
 * and the payments print in the arena case through their opt-in `arena` prop,
 * and their insides are dressed in TransactionHistoryPage.css under the page's
 * arena root. The wallet, the Financials page and the Tournament Results page
 * do not pass `arena`, and their own sheets are untouched, so they keep their
 * look.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const pageCss = read('src/pages/TransactionHistoryPage.css');
const page = read('src/pages/TransactionHistoryPage.tsx');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(/,(?![^(]*\))/))
    .map((s) => s.trim());
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the Transaction Ledger arena dress is scoped', () => {
  it('the page root carries the arena workspace and its mast, never the Rewards Circuit header', () => {
    expect(page).toContain('className="transaction-history-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('RewardsSurfaceHeader');
    expect(page).toMatch(/<ChipStatement[\s\S]*?\barena\b[\s\S]*?\/>/);
  });

  it('dresses the shared statement, payments and week only under the page arena root', () => {
    const shared = selectors(pageCss).filter((s) =>
      /chip-statement|tournament-payments|rakeback-week|arena-switch/.test(s)
    );
    expect(shared.length).toBeGreaterThan(10);
    for (const s of shared)
      expect(s.startsWith('.transaction-history-page.arena-workspace ')).toBe(true);
  });

  it('leaves the shared sheets themselves untouched by the arena', () => {
    expect(read('src/components/wallet/ChipStatement.css')).not.toContain('arena');
    expect(read('src/components/tournament/TournamentPaymentStatus.css')).not.toContain('arena');
  });

  it('only the Transaction Ledger opts the statement and the payments into the arena', () => {
    const optIns = sources('src')
      .filter((path) => /<(ChipStatement|TournamentPaymentStatus)\b[^>]*\barena\b/.test(read(path)))
      .sort();
    expect(optIns).toEqual([
      join('src', 'components', 'wallet', 'ChipStatement.tsx'),
      join('src', 'pages', 'TransactionHistoryPage.tsx'),
    ]);
    // ChipStatement forwards only its own `arena` to the payments under it.
    expect(read('src/components/wallet/ChipStatement.tsx')).toContain(
      'arena={arena || undefined} />'
    );
  });

  it('the rakeback week, which carries the case classes, renders on this page only', () => {
    const hosts = sources('src').filter((path) => read(path).includes('<RakebackWeekSoFar'));
    expect(hosts).toEqual([join('src', 'pages', 'TransactionHistoryPage.tsx')]);
  });
});
