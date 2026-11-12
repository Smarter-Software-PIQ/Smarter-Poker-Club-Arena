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
  inLightningRoom: true,
  roomClosed: false,
  handInProgress: true,
  handSettling: false,
  heroStatus: 'active',
};

describe('Lightning Leave Next Hand waits for the end of the current hand', () => {
  it('waits while the player is live in the hand, all in included', () => {
    expect(lightningLeaveWaitsForHand(live)).toBe(true);
    expect(lightningLeaveWaitsForHand({ ...live, heroStatus: 'all_in' })).toBe(true);
  });
  it('leaves once the hand is over for the player', () => {
    expect(lightningLeaveWaitsForHand({ ...live, handSettling: true })).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, handInProgress: false })).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, heroStatus: 'folded' })).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, heroStatus: undefined })).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, roomClosed: true })).toBe(false);
    expect(lightningLeaveWaitsForHand({ ...live, inLightningRoom: false })).toBe(false);
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
    expect(body).toMatch(/if \(lightningHeroInLiveHand\) \{\s+lightningLeaveAfterHand\.queue\(\);/);
    const hook = PAGE.slice(PAGE.indexOf('useLightningLeaveAfterHand({'));
    expect(hook).toMatch(/waits: lightningHeroInLiveHand,\s+leave: handleLeaveTable,/);
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
