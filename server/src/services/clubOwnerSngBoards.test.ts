/**
 * Dan 2026-09-01 (Deep Stack Society directive): heads-up / SNG boards must
 * open for activated CLUB owners, not just the house board.
 *
 * Before this change checkAndLaunchSNGs ran exactly one ensureBoardOpen pass
 * against this.houseOwner, so a standalone club that had activated and funded
 * its games (Deep Stack Society, club 11192) could never list a heads-up
 * game: the Spin pass looped activatedSpinOwners() but the SNG pass did not.
 * createSNG was already owner-ready -- it stamps club_id/union_id from the
 * BoardOwner it is handed -- the loop was the only missing piece.
 *
 * These are source pins in the same style as
 * ClosedTableHuskCannotAbsorbTheBoard: the call site is where the regression
 * would come back. Each pin was run against the pre-change source and
 * observed red before the change shipped.
 *
 * 2026-09-03: the budget pins changed with the rule. The house used to open
 * FIRST on one shared BURST "so owner boards cannot starve it", and being
 * thirty-odd games short every tick it spent all twelve and starved every
 * owner board instead (Deep Stack Society's spin board sat empty from 11:32).
 * Every board now gets its own share of BURST up front (boardBudgetShares),
 * so neither side can starve the other and the order no longer carries the
 * guarantee. See theClubProgrammeMirrorsTheHouse.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RECURRING = readFileSync(
  join(process.cwd(), 'src/services/TournamentRecurringService.ts'),
  'utf8'
);

/** The body of checkAndLaunchSNGs, from its declaration to the next method. */
function sngPassSource(): string {
  const start = RECURRING.indexOf('private async checkAndLaunchSNGs');
  expect(start).toBeGreaterThan(-1);
  const rest = RECURRING.slice(start);
  const end = rest.indexOf('private async', 'private async'.length);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the SNG board opens for activated club owners', () => {
  it('the SNG pass loops activatedSpinOwners, like the Spin pass', () => {
    const src = sngPassSource();
    expect(src).toMatch(/const owners = await this\.activatedSpinOwners\(\);/);
    expect(src).toMatch(/for \(const owner of owners\) \{/);
  });

  it("an owner board only offers buy-ins the owner's stake covers", () => {
    // `board` since 2026-11-08: the house and each owner are one drawn list,
    // so the house takes SNG_CONFIGS whole and an owner takes its own slice.
    expect(sngPassSource()).toMatch(/SNG_CONFIGS\.filter\(\(c\) => c\.buyIn <= board\.maxStake\)/);
  });

  it('every board takes its turn at the shared creation and horse-seeding budgets', () => {
    /* Dan 2026-11-22: every missing Heads-Up option stays open empty (0/2)
       under the per-tick BURST creation budget, while horse-seeding is capped
       separately at SNG_BOARD_OPEN_TARGET = 2 ("only a couple of 1 of 2's"). */
    const src = sngPassSource();
    expect(src).toMatch(/const room = await this\.seatFirstBoardRoom\('sng'\);/);
    expect(src).toMatch(
      /const seedBudget = \{ left: Math\.min\(room, boardBudgetShares\(1\)\) \};/
    );
    expect(src).toMatch(/const budget = \{ left: boardBudgetShares\(1\) \};/);
    expect(src).toMatch(/for \(const board of this\.boardOpenOrder\(owners\)\)/);
    // The one call in that loop spends the shared budgets.
    const sngCalls = src.split(/this\.ensureBoardOpen\(\s*'sng',/).slice(1);
    expect(sngCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of sngCalls) {
      expect(call.slice(0, call.indexOf(');'))).toMatch(/budget/);
      expect(call.slice(0, call.indexOf(');'))).toMatch(/seedBudget/);
    }
  });

  it('a board stops the pass only when both platform budgets are spent', () => {
    expect(sngPassSource()).not.toMatch(/const budget = \{ left: BURST \};/);
    expect(sngPassSource()).toMatch(/if \(budget\.left <= 0 && seedBudget\.left <= 0\) break;/);
  });
});
