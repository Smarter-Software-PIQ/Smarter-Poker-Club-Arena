/**
 * LAW: a break never starts in the middle of a hand.
 * ═══════════════════════════════════════════════════════════════════════════
 * Dan, 2026-11-06, verbatim: "ANY AND ALL SCHEDULED BREAKS OR MAINTENANCE
 * BREAKS MUST FINISH THE CURRENT HAND THEY ARE ON, BEFORE THE BREAK STARTS.
 * BREAKING IN THE MIDDLE OF THE HAND MAKES THE PLATFORM 'FEEL BROKEN'. NOBODY
 * DOES IT LIKE THAT. YOU MUST ALWAYS 'CALL LAST HAND' AND THEN ONLY START
 * EITHER BREAK AFTER ALL THE HANDS HAVE FINISHED."
 *
 * The engine already called the last hand and waited for settlement, but the
 * dealing loop parked a table at the pause gate IMMEDIATELY after dealHand()
 * resolved - before the hand-completion display (winner shown, pot pushed with
 * its total, cards mucked) and before the hand-free broadcast that clears the
 * felt. Both were deferred until the break ended, so the whole break showed the
 * hand's last action frozen on the felt under a "Break: Paused" clock: bets in
 * front, ALL IN badges, an unpushed pot and the winner's stack not yet credited
 * (40 Chip Bounty Freezeout - 2.5K GTD, Table 4, hand 56221104, settled
 * 2026-11-07 03:55:25 UTC; felt frozen until the 04:05 resume).
 *
 * The rule pinned here: between `await this.dealHand(activePlayers)` and the
 * hand-free broadcast nothing parks, and the post-hand park sits after the
 * completion hold, the hand-free broadcast and the arming of the rest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const DEALING = strip(
  readFileSync(join(ROOT, 'server/src/engine/ServerTableEngineDealing.ts'), 'utf8')
);

describe('LAW: a break never starts in the middle of a hand (Dan 2026-11-06)', () => {
  const deal = DEALING.indexOf('await this.dealHand(activePlayers);');
  const hold = DEALING.indexOf("this.setLoopPhase('post_hand_hold');", deal);
  const display = DEALING.indexOf('await this.awaitHandCompletionDisplay(', hold);
  const broadcast = DEALING.indexOf('this.broadcastCurrentState();', display);
  const arm = DEALING.indexOf('this.armNextHandRest(', broadcast);

  it('the dealing loop deals, holds for the completion display, clears the felt and arms the rest in that order', () => {
    expect(deal).toBeGreaterThan(-1);
    expect(hold).toBeGreaterThan(deal);
    expect(display).toBeGreaterThan(hold);
    expect(broadcast).toBeGreaterThan(display);
    expect(arm).toBeGreaterThan(broadcast);
  });

  it('nothing parks a table between the end of dealHand and the hand-free broadcast', () => {
    const settledToClean = DEALING.slice(deal, broadcast);
    expect(settledToClean).not.toMatch(/awaitPauseGate\(/);
    expect(settledToClean).not.toMatch(/'parked_for_pause'/);
  });

  it('the post-hand park follows the hand-free broadcast and covers every pause owner', () => {
    const park = DEALING.indexOf("this.setLoopPhase('parked_for_pause');", arm);
    const nextIteration = DEALING.indexOf('justBustedPlayers', arm);
    expect(park).toBeGreaterThan(arm);
    expect(park).toBeLessThan(nextIteration);
    const guard = DEALING.slice(arm, park);
    for (const owner of [
      'this.handForHandPaused',
      'this.weeklyPayoutPauseOwners.size > 0',
      'this.maintenancePaused',
      'this.finalTableDealPaused',
      'this.terminalCloseoutPaused',
      'this.tournamentMovePauseOwners.size > 0',
    ]) {
      expect(guard).toContain(owner);
    }
    expect(DEALING.slice(park, nextIteration)).toMatch(/await this\.awaitPauseGate\(\);/);
  });
});
