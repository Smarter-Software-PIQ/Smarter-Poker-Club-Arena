/**
 * THE WALLET'S ARENA DRESS IS SCOPED TO ITS PAGE (#SmarterDesign player pages
 * batch P3, 2026-11-28)
 *
 * The Wallet wears the arena workspace. Its dress lives in
 * src/pages/PlayerWalletArena.css and dresses two shared pieces as well as the
 * page's own: CashierWorkspace (also mounted by the Cashier, Statements and
 * Trade pages) and DiamondLedgerMore's Load Older key. Every rule is scoped
 * under the wallet's arena root, so no other surface that mounts them changes,
 * and the shared sheets themselves carry no wallet dress.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const arenaCss = readFileSync('src/pages/PlayerWalletArena.css', 'utf8');
const page = readFileSync('src/pages/PlayerWalletPage.tsx', 'utf8');
const workspaceCss = readFileSync('src/components/wallet/CashierWorkspace.css', 'utf8');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s));
}

describe('the Wallet arena dress is scoped', () => {
  it('the page root carries the arena workspace and keeps its surface hook', () => {
    expect(page).toContain('className="wallet-page arena-workspace" data-arena-surface="wallet"');
    expect(page).toContain("import './PlayerWalletArena.css';");
  });

  it('every rule of the arena sheet sits under the wallet arena root', () => {
    const all = selectors(arenaCss)
      .flatMap((s) => s.split(/,(?![^(]*\))/))
      .map((s) => s.replace(/\s+/g, ' ').trim());
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(s.startsWith('.wallet-page.arena-workspace'), s).toBe(true);
    expect(all.some((s) => s.includes('.cashier-workspace'))).toBe(true);
    expect(all.some((s) => s.includes('.vault-btn--wide'))).toBe(true);
  });

  it('leaves the shared Cashier workspace sheet untouched by the wallet', () => {
    expect(workspaceCss).not.toContain('wallet');
    expect(workspaceCss).not.toContain('arena');
  });
});
