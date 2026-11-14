/**
 * Dan 2026-11-12: "WHEN YOU CLICK 'LEAVE NEXT HAND' AT THE TOP OF THE PAGE
 * WHEN PLAYING LIGHTNING GAMES, IT MEANS AFTER THE END OF THE CURRENT HAND,
 * YOU LEAVE THE TABLE. NOT AT THAT EXACT MOMENT."
 *
 * The button used to stop matchmaking and then call the page's leave at once,
 * which folded the live hand and cashed the player out mid-hand. The leave now
 * waits for the hand in front of the player to end.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lightningLeaveWaitsForHand } from '../../src/lightning/lightningLeaveNextHand';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const PAGE = read('src/pages/TablePage.tsx');

const live = {
  stage: 'flop',
  hand_id: 'current',
  players: [{ user_id: 'hero', is_folded: false, is_all_in: true }],
};

describe('Lightning Leave Next Hand waits for the end of the current hand', () => {
  it('a different hand settling or a missing player in a live snapshot cannot release this hand', () => {
    expect(lightningLeaveWaitsForHand(live, 'previous', 'hero')).toBe(true);
    expect(lightningLeaveWaitsForHand({ ...live, players: [] }, null, 'hero')).toBe(true);
  });
  it('leaves on this hand’s receipt, an idle room, or the hero’s confirmed fold', () => {
    expect(lightningLeaveWaitsForHand(live, 'current', 'hero')).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, stage: 'waiting' }, null, 'hero')).toBe(false);
    expect(
      lightningLeaveWaitsForHand(
        { ...live, players: [{ user_id: 'hero', is_folded: true }] },
        null,
        'hero'
      )
    ).toBe(false);
  });
  it('the button is wired to the waiting leave and its cancel, never straight to the immediate one', () => {
    const at = PAGE.indexOf('<LightningLeaveControl');
    const tag = PAGE.slice(at, PAGE.indexOf('/>', at));
    expect(tag).toContain('onLeave={leaveLightningAfterThisHand}');
    expect(tag).not.toContain('onLeave={handleLeaveTable}');
    expect(tag).toContain('queued={lightningLeaveAfterHand.queued}');
    expect(tag).toContain('onCancel={cancelLightningLeave}');
    // Nothing suppresses the action bar or cancels pre-actions while the hand plays.
    expect(tag).not.toContain('onLeaveIntentChange');
  });
  it('the waiting leave queues during a live hand through the saved queue', () => {
    const body = PAGE.slice(PAGE.indexOf('const leaveLightningAfterThisHand'));
    expect(body).toContain(
      'lightningLeaveAfterHand.queue(stop.inHand && !lightningHeroInLiveHand)'
    );
    expect(body).toMatch(/if \(stop.exited && !stop.inHand\) \{\s+await handleLeaveTable\(true\)/);
    expect(PAGE).toContain('if (!afterLightningHand && lightningRoomRef.current && tableId)');
    const hook = PAGE.slice(PAGE.indexOf('useLightningLeaveAfterHand({'));
    expect(hook).toMatch(
      /waits: lightningHeroInLiveHand,\s+leave: \(\) => handleLeaveTable\(true\),/
    );
    // Never off a half-hydrated felt after a reload.
    expect(hook).toMatch(/ready:\s+lightningRoomClosed \|\|\s+\(!!engineSnapshot &&/);
  });
  it('a cancel withdraws the stop and re-arms it for next time', () => {
    const body = PAGE.slice(PAGE.indexOf('const cancelLightningLeave'));
    expect(body).toMatch(/resumeLightningPlaying\(room\.clusterId\)/);
    expect(body).toMatch(/lightningLeaveAfterHand\.clear\(\);\s+stopLightningForLeave\.reset\(\);/);
  });
  it('a settled hand is never folded on the way out', () => {
    expect(PAGE).toMatch(/const handStillLive = tableState\.isHandInProgress && !handSettling;/);
  });
});
