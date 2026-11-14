/**
 * A limit table reads by its BLINDS, in the lobby and at the table alike.
 *
 * OWNER RULING, NOVEMBER 14, 2026
 * -------------------------------
 * Dan: "GAME LIMITS SHOULD BE .25/.50 .50/1.00 1/2 2/5 AND 5/10" and "IT
 * SHOULD BE DISPLAYED AS 'FIXED LIMIT 1/2'". Until then fixed limit was posted
 * by BET size (blinds 1/2 read "FLH 2/4"), so the 2/5 and 5/10 blind games read
 * "5/10" and "10/20" and the ladder Dan set looked broken. Every game now reads
 * by its blinds; the bets themselves are unchanged (small bet = big blind, big
 * bet = twice it, see fixedLimitBetSize).
 *
 * WHAT THE 2026-08-24 VERSION OF THIS FILE GUARDED STILL HOLDS: the lobby row
 * and the label the create screen writes go through the one `stakesLabel()`,
 * so they cannot disagree, and no-limit and pot-limit rows are not disturbed.
 */
import { describe, it, expect } from 'vitest';
import { cashEntry, type LobbyTableRow } from '../../src/components/lobby/lobbyEntries';
import { stakesLabel } from '../../src/lib/bettingStructure';

const row = (over: Partial<LobbyTableRow> = {}): LobbyTableRow =>
  ({
    id: 't1',
    name: 'Test Table',
    game_variant: 'nlh',
    small_blind: 1,
    big_blind: 2,
    min_buy_in: 40,
    max_buy_in: 200,
    max_players: 9,
    status: 'running',
    ...over,
  }) as LobbyTableRow;

describe('the lobby posts a limit table by its blinds', () => {
  it('shows 1/2 for a fixed-limit table whose blinds are 1/2', () => {
    for (const v of ['flh', 'flo4', 'flo5', 'flo6', 'flo8']) {
      expect(cashEntry(row({ game_variant: v })).stakesLabel, v).toBe('1/2');
    }
  });

  it('agrees exactly with the label the create screen wrote', () => {
    // TableConfigPage builds tables.stakes from the same helper. If these two
    // ever diverge the lobby and the table disagree again.
    for (const v of ['flh', 'flo8', 'flo4', 'nlh', 'plo4']) {
      expect(cashEntry(row({ game_variant: v })).stakesLabel).toBe(stakesLabel(1, 2, v));
    }
  });

  it("reads every rung of the owner's ladder exactly as he wrote it", () => {
    const ladder: Array<[number, number, string]> = [
      [0.25, 0.5, '0.25/0.50'],
      [0.5, 1, '0.50/1'],
      [1, 2, '1/2'],
      [2, 5, '2/5'],
      [5, 10, '5/10'],
    ];
    for (const [sb, bb, label] of ladder) {
      expect(
        cashEntry(row({ game_variant: 'flh', small_blind: sb, big_blind: bb })).stakesLabel
      ).toBe(label);
    }
  });

  it('leaves no-limit and pot-limit rows reading as blinds', () => {
    // The blinds ARE the stakes for these; relabelling them would be a
    // regression dressed as a fix.
    expect(cashEntry(row({ game_variant: 'nlh' })).stakesLabel).toBe('1/2');
    expect(cashEntry(row({ game_variant: 'plo4' })).stakesLabel).toBe('1/2');
    expect(cashEntry(row({ game_variant: 'short_deck' })).stakesLabel).toBe('1/2');
  });

  it('says nothing rather than claiming a row with missing blinds is 0/0', () => {
    /* Lobby rows come straight from the database and a legacy row can be null.
       `|| 0` used to turn "we do not know" into a STATEMENT: stakesLabelFor
       has no unknown branch, so the board printed "0/0" and CasinoPlaque
       rendered "Blinds 0/0". stakesLabel is `string | null` for exactly this,
       and every renderer already falls back when it is null. */
    for (const variant of ['flh', 'nlh', 'plo4']) {
      const e = cashEntry(row({ game_variant: variant, small_blind: 0, big_blind: 0 }));
      expect(e.stakesLabel, `${variant} invented a stake`).toBeNull();
    }
    // A null column, not merely a zero, is the shape that actually ships.
    const nulled = cashEntry(
      row({ game_variant: 'nlh', small_blind: null, big_blind: null } as never)
    );
    expect(nulled.stakesLabel).toBeNull();
    expect(nulled.stakesValue).toBe(0);
  });

  it('sorts on the stakes it prints, so a limit 1/2 groups with every 1/2', () => {
    // stakesValue drives the lobby's stake sort and is the larger printed
    // figure (2026-10-24). Every game now prints its blinds, so that is the
    // big blind for limit as for everything else, and a "1/2" limit game sorts
    // with every other "1/2" (Dan 2026-10-23: "DISPLAY ALL THE 1/2 GAMES FIRST
    // ... AND THEN DO THE .50/1.00 GAME").
    expect(cashEntry(row({ game_variant: 'flh' })).stakesLabel).toBe('1/2');
    expect(cashEntry(row({ game_variant: 'flh' })).stakesValue).toBe(2);
    expect(cashEntry(row({ game_variant: 'nlh' })).stakesValue).toBe(2);
  });
});
