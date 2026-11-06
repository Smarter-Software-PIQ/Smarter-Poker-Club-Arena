import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Dan 2026-11-05: a PKO knockout paid the winner and grew his head in the
// ledger, but the table badge kept the old head until someone reloaded. A head
// read that started before the knockout committed landed after the knockout's
// badge update and put the old head back. These are the guards that stop it.
const page = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.tsx'), 'utf8');

describe('a knockout head is never overwritten by a stale read', () => {
  it('discards a head read that started before the latest knockout', () => {
    expect(page).toContain('const gen = bountyMapGenRef.current;');
    expect(page).toMatch(/if \(gen !== bountyMapGenRef\.current\) \{/);
  });
  it('bumps the generation and re-reads the ledger heads on every knockout', () => {
    const at = page.indexOf('const headWinners = bountyWinnersOf(b);');
    expect(at).toBeGreaterThan(0);
    const end = page.indexOf("} else if (data?.type === 'level_up')", at);
    expect(end).toBeGreaterThan(at);
    const tail = page.slice(at, end);
    expect(tail).toContain('bountyMapGenRef.current += 1;');
    expect(tail).toContain('void bountyMapRefreshRef.current?.();');
  });
  it('re-reads the heads on every hand and polls at most ten seconds apart', () => {
    expect(page).toMatch(/const BOUNTY_HEAD_POLL_MS = 10_000;/);
    expect(page).toContain('setInterval(() => void refreshBountyMap(), BOUNTY_HEAD_POLL_MS)');
    expect(page).toMatch(/\}, \[bountyHandNumber, tableState\.isBountyTournament\]\);/);
  });
  it('reads the heads again after a bust has had time to settle', () => {
    expect(page).toMatch(/const BOUNTY_SETTLE_REREAD_MS = 8_000;/);
    expect(page).toMatch(
      /setTimeout\(\s*\(\) => void bountyMapRefreshRef\.current\?\.\(\),\s*BOUNTY_SETTLE_REREAD_MS/
    );
  });
});
