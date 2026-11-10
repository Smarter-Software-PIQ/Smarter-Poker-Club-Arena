/**
 * LIGHTNING CHECK/FOLD IN THE BIG BLIND (Dan 2026-11-10, Lightning only).
 *
 * Dan: "while in the big blind, check fold didn't auto fold me, it still made
 * me click it twice" and "i clicked check fold but it didn't move me while in
 * the bb, and even when action was on me, it released the check fold, it
 * didn't auto fold me and move me to the next table. it made me hit fold
 * again."
 *
 * Production hand 58348362 (big blind, 15:47:43Z): the fold was a request the
 * engine held for the turn, not a release at the raise. Two causes, fixed here:
 * the bar judged "owes nothing" from the page's per-seat bet display, which can
 * trail the posted big blind (so the free Check/Fold went out as a fold
 * request); and the host kept a fold requested on a free seat until its turn
 * even after a raise priced it (pinned in
 * server/src/lightning/LightningHandHost.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lightningHeroToCall } from '../../src/lightning/lightningCheckFold';
import { serverPreActionFor } from '../../src/lib/preActionSync';

const ROOT = resolve(__dirname, '../..');
const PAGE = readFileSync(join(ROOT, 'src/pages/TablePage.tsx'), 'utf8');
const HOST = readFileSync(join(ROOT, 'server/src/lightning/LightningHandHost.ts'), 'utf8');

const HERO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snap = (currentBet: unknown, heroBet: unknown) => ({
  current_bet: currentBet,
  players: [
    { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', bet: 0.25 },
    { user_id: HERO, bet: heroBet },
  ],
});

describe('what the hero owes comes from the engine', () => {
  it('the posted big blind owes nothing in an unraised pot', () => {
    expect(lightningHeroToCall(snap(0.5, 0.5), HERO)).toBe(0);
  });
  it('a raise prices it', () => {
    expect(lightningHeroToCall(snap(1.33, 0.5), HERO)).toBe(0.83);
  });
  it('cannot say without both numbers or the hero', () => {
    expect(lightningHeroToCall(null, HERO)).toBeNull();
    expect(lightningHeroToCall(snap(0.5, 0.5), null)).toBeNull();
    expect(lightningHeroToCall(snap('0.5', 0.5), HERO)).toBeNull();
    expect(lightningHeroToCall(snap(0.5, undefined), HERO)).toBeNull();
    expect(lightningHeroToCall({ current_bet: 0.5, players: [] }, HERO)).toBeNull();
  });
  it('a free big blind arms Check/Fold, never a bare fold', () => {
    const owes = lightningHeroToCall(snap(0.5, 0.5), HERO)!;
    expect(serverPreActionFor('fold', owes <= 0)).toBe('auto_check_fold');
  });
});

describe('the table page reads the engine pair in a Lightning room', () => {
  const bar = PAGE.slice(
    PAGE.indexOf('<PreActionBar'),
    PAGE.indexOf('setPreAction(next);', PAGE.indexOf('<PreActionBar'))
  );
  it('for the offered labels, the free test, the arm and the price', () => {
    expect(bar).toContain('lightningHeroToCall(engineSnapshot, userId)');
    expect(bar).toContain('lightningHeroToCall(engineSnapshotRef.current, userId)');
    expect(bar).toMatch(/heroOwesNothing =\s+lightningOwes !== null/);
    expect(bar).toMatch(/preActionCanCheckRef\.current =\s+lightningOwes !== null/);
    expect(bar).toMatch(/preActionCallAmountRef\.current =\s+lightningOwes !== null/);
  });
});

describe('the host releases a held fold the moment a bet prices it', () => {
  it('a pending fold on a newly priced seat is released, once', () => {
    const body = HOST.slice(
      HOST.indexOf('private releasePricedCheckFolds(): void {'),
      HOST.indexOf('setPreAction(', HOST.indexOf('private releasePricedCheckFolds(): void {'))
    );
    expect(body).toMatch(
      /if \(this\.pendingFolds\.has\(userId\)\) \{\s+if \(!this\.releasedOrRecorded\.has\(userId\)\) this\.afterFold\(userId, 'fast'\);/
    );
  });
});
