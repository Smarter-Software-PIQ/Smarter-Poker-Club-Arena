/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AN UNCLAIMABLE MOVE DOES NOT OUTLAST THE LAST PAUSE (2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE LAW. When the last real pause on a table lets go - the add-on break,
 * the :55 tournament break, the maintenance freeze, hand-for-hand, a weekly
 * payout, a final-table deal, a terminal closeout - the table deals. An
 * UNCLAIMED tournament-move owner on a table carrying a retained,
 * never-started original is not a pause that can hold the gate: it can claim
 * only at a between-hands boundary, which that table reaches only by playing
 * the original. A CLAIMED move owner, and a move owner on a table that is
 * between hands, still hold it.
 *
 * Measured 2026-11-05, Union Mystery Bounty (PLO5) 7576aeb1, table 41d47e9d:
 * the add-on hold parked a retained original at 22:52:05; the gap balancer
 * fenced the table every ~7s; the add-on minute, the :55 break, the freeze
 * and the break end at 23:05:00 all deferred to that fence; the four sibling
 * tables dealt at 23:05 and this one waited for the 600s pause safety
 * timeout at 23:12:05.
 *
 * Every release path asks one predicate, so a future pause authority cannot
 * reintroduce the deadlock by checking the raw owner set again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceMethod } from '../testHelpers/sourceWindow.js';

const ENGINE_SRC = readFileSync(
  resolve(process.cwd(), 'src/engine/ServerTableEngineBase.ts'),
  'utf8'
);

const RELEASES = [
  'isHandForHandReleaseBlocked(): boolean',
  'resumeFromMaintenance(): void',
  'resumeFromFinalTableDeal(): void',
  'releaseTerminalCloseoutPause(): void',
  'resumeFromWeeklyPayout(owner: string): void',
];

describe('an unclaimable move does not outlast the last pause', () => {
  it('lets an unclaimed owner on a retained original go, and nothing else', () => {
    const predicate = sliceMethod(ENGINE_SRC, 'private tournamentMoveHoldsRelease(): boolean');
    expect(predicate).toContain('if (this.tournamentMovePauseOwners.size === 0) return false;');
    expect(predicate).toContain('if (this.claimedTournamentMovePauseOwners.size > 0) return true;');
    expect(predicate).toContain('return this.retainedPreparedOriginalController === null;');
  });

  it.each(RELEASES)('%s asks the predicate, not the raw owner set', (signature) => {
    const body = sliceMethod(ENGINE_SRC, signature);
    expect(body).toContain('this.tournamentMoveHoldsRelease()');
    expect(body).not.toMatch(/this\.tournamentMovePauseOwners\.size\s*>\s*0/);
  });

  it('resumeDealing defers only through isHandForHandReleaseBlocked', () => {
    const body = sliceMethod(ENGINE_SRC, 'resumeDealing(): void');
    expect(body).toContain('if (this.isHandForHandReleaseBlocked()) {');
    expect(body).not.toMatch(/this\.tournamentMovePauseOwners\.size/);
  });
});
