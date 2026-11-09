/**
 * LIGHTNING CHECK/FOLD (Dan 2026-11-09, Lightning games only).
 *
 * Dan, verbatim: "when your in the sb or bb you should still be able to 'fast
 * fold' when you hit the 'check/fold' button. it should 'fold you in that
 * hand' right away, even though the action and avatar doesn't change or remove
 * until the action is on you. if you aren't folded pre, or on any other
 * street, the 'check/fold' stays active for all streets until someone bets, or
 * the player reaches showdown. they do not have to stay at the table or re
 * select check/fold on any other streets. (this applies only to lightning
 * games)"
 *
 * The engine half is pinned in server/src/lightning/LightningHandHost.test.ts
 * (the Check/Fold cases). This file pins the room's half: the two pure rules
 * and the five places the table page reads them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  lightningCheckFoldCarries,
  lightningCheckFoldReleaseDue,
  lightningCheckFoldSurvives,
} from '../../src/lightning/lightningCheckFold';

const ROOT = resolve(__dirname, '../..');
const PAGE = readFileSync(join(ROOT, 'src/pages/TablePage.tsx'), 'utf8');
const HOST = readFileSync(join(ROOT, 'server/src/lightning/LightningHandHost.ts'), 'utf8');

const HAND = 'id:11111111-1111-4111-8111-111111111111';
const NEXT = 'id:22222222-2222-4222-8222-222222222222';

describe('the engine says whether it carries the arm', () => {
  it('only an explicit true counts', () => {
    expect(lightningCheckFoldCarries({ lightning: { check_fold_carries: true } as never })).toBe(
      true
    );
    for (const v of [undefined, null, false, 'true', 1])
      expect(lightningCheckFoldCarries({ lightning: { check_fold_carries: v } as never })).toBe(
        false
      );
    expect(lightningCheckFoldCarries(null)).toBe(false);
    expect(lightningCheckFoldCarries({ lightning: null })).toBe(false);
  });
  it('the host advertises it beside fold_on_turn', () => {
    expect(HOST).toMatch(/fold_on_turn: true,[\s\S]{0,300}?check_fold_carries: true,/);
  });
});

describe('an armed Check/Fold lives for its own hand, not for one street', () => {
  const live = {
    lightningRoom: true,
    armedHandKey: HAND,
    currentHandKey: HAND,
    handInProgress: true,
    engineCarries: true,
  };
  it('survives a street change and the hero’s own free check in the same hand', () => {
    expect(lightningCheckFoldSurvives(live)).toBe(true);
  });
  it('never survives into another hand, or with no hand on the felt', () => {
    expect(lightningCheckFoldSurvives({ ...live, currentHandKey: NEXT })).toBe(false);
    expect(lightningCheckFoldSurvives({ ...live, currentHandKey: null })).toBe(false);
    expect(lightningCheckFoldSurvives({ ...live, handInProgress: false })).toBe(false);
  });
  it('is spent as before when nothing of the kind is armed', () => {
    expect(lightningCheckFoldSurvives({ ...live, armedHandKey: null })).toBe(false);
    expect(lightningCheckFoldSurvives({ ...live, armedHandKey: null, currentHandKey: null })).toBe(
      false
    );
  });
  it('a Classic table is never affected', () => {
    expect(lightningCheckFoldSurvives({ ...live, lightningRoom: false })).toBe(false);
  });
  it('the toggle never stays lit against an engine that has already spent the arm', () => {
    expect(lightningCheckFoldSurvives({ ...live, engineCarries: false })).toBe(false);
  });
});

describe('a bet that prices the armed Check/Fold releases the player at once', () => {
  const due = {
    lightningRoom: true,
    preAction: 'fold',
    armedForThisHand: true,
    callDue: 6,
    heroTurn: false,
    handLive: true,
    fastFoldOffered: true,
    engineReleasesPricedFold: true,
    engineCarries: false,
  };
  it('the room sends Lightning Fold for an engine that does not release it itself', () => {
    expect(lightningCheckFoldReleaseDue(due)).toBe(true);
  });
  it('an engine that carries the arm releases it; the room sends nothing', () => {
    expect(lightningCheckFoldReleaseDue({ ...due, engineCarries: true })).toBe(false);
  });
  it('a free check is never folded', () => {
    expect(lightningCheckFoldReleaseDue({ ...due, callDue: 0 })).toBe(false);
  });
  it('never on the hero’s own turn, on a dead hand, or with Lightning Fold switched off', () => {
    expect(lightningCheckFoldReleaseDue({ ...due, heroTurn: true })).toBe(false);
    expect(lightningCheckFoldReleaseDue({ ...due, handLive: false })).toBe(false);
    expect(lightningCheckFoldReleaseDue({ ...due, fastFoldOffered: false })).toBe(false);
  });
  it('never for another armed choice, another hand’s arm, or an engine that queues priced folds', () => {
    for (const preAction of [null, 'check', 'call', 'callAny'])
      expect(lightningCheckFoldReleaseDue({ ...due, preAction })).toBe(false);
    expect(lightningCheckFoldReleaseDue({ ...due, armedForThisHand: false })).toBe(false);
    expect(lightningCheckFoldReleaseDue({ ...due, engineReleasesPricedFold: false })).toBe(false);
  });
  it('a Classic table is never affected', () => {
    expect(lightningCheckFoldReleaseDue({ ...due, lightningRoom: false })).toBe(false);
  });
});

describe('the table page reads the two rules in every place the arm can be spent', () => {
  it('the street boundary keeps a carried arm and still clears everything else', () => {
    const start = PAGE.indexOf('usePreActionBoundary(\n    tableState.handNumber,');
    const block = PAGE.slice(start, PAGE.indexOf('}, [])\n  );', start));
    expect(start).toBeGreaterThan(0);
    expect(block).toMatch(
      /if \(\s*lightningCheckFoldSurvives\(\{[\s\S]*?armedHandKey: lightningCheckFoldArmRef\.current,[\s\S]*?\}\)\s*\)\s*return;\s*lightningCheckFoldArmRef\.current = null;\s*setPreAction\(null\);/
    );
  });
  it('the hero’s own free check does not spend it; any other hero action does', () => {
    const start = PAGE.indexOf('acceptedActionSpendsPreAction({');
    const block = PAGE.slice(start, start + 1600);
    expect(block).toMatch(/!\(\s*action === 'check' &&\s*lightningCheckFoldSurvives\(\{/);
    expect(block).toMatch(/lightningCheckFoldArmRef\.current = null;\s*setPreAction\(null\);/);
  });
  it('the bar binds a free Check/Fold to the hand it was armed in', () => {
    expect(PAGE).toMatch(
      /lightningCheckFoldArmRef\.current =\s*lightningRoom && next === 'fold' \? lightningHandKeyNow : null;/
    );
  });
  it('the release goes through the button’s own handler, quietly, once per pricing', () => {
    expect(PAGE).toMatch(
      /useEffect\(\(\) => \{\s*if \(lightningCheckFoldDue\) void lightningFoldHandlerRef\.current\('fast_fold', true\);\s*\}, \[lightningCheckFoldDue\]\);/
    );
    const start = PAGE.indexOf('const handleLightningFold = useCallback(');
    const handler = PAGE.slice(start, PAGE.indexOf('lightningHotkeysRef.current =', start));
    // The handler disarms before it sends, so one pricing sends one request.
    expect(handler).toMatch(
      /lightningFoldBusyRef\.current = true;[\s\S]{0,200}?lightningCheckFoldArmRef\.current = null;\s*setPreAction\(null\);/
    );
  });
  it('a fold the engine made for the arm is shown as a fold: cue and muck inside the exit hold', () => {
    const start = PAGE.indexOf('const lightningExitHoldRef = useRef');
    const block = PAGE.slice(start, PAGE.indexOf('const mapped = mapEngineSnapshot(', start));
    expect(block).toMatch(
      /if \(lightningCheckFoldArmRef\.current !== null\) \{\s*lightningCheckFoldArmRef\.current = null;/
    );
    expect(block).toContain("players[idx] = { ...row, status: 'folded' as typeof row.status };");
    expect(block).toContain('soundService.playFold();');
  });
});

describe('the engine: one arm, every street, released on the bet', () => {
  it('re-arms only its own free check, in the same hand, for a player still in it', () => {
    const start = HOST.indexOf('private runPreAction(userId: string): boolean {');
    const fn = HOST.slice(start, HOST.indexOf('private releasePricedCheckFolds(): void {', start));
    expect(fn).toMatch(
      /armed === 'auto_check_fold' &&\s*r\.action === 'check' &&\s*this\.hc === hc &&\s*this\.state === 'dealing' &&\s*this\.watching\.has\(userId\) &&\s*!this\.pendingFolds\.has\(userId\)/
    );
  });
  it('releases through the existing private fold request, never a second fold path', () => {
    const start = HOST.indexOf('private releasePricedCheckFolds(): void {');
    const fn = HOST.slice(start, HOST.indexOf('\n  }\n', start));
    expect(fn).toContain("this.requestFold(userId, 'fast')");
    expect(fn).toContain('me.seat === st.currentPlayerSeat');
    expect(fn).toContain('if (!this.foldFlagsNow().fastFold) return;');
    // Horses are players (CLAUDE.md 10.5): the rule never asks who is asking.
    expect(fn).not.toMatch(/isHorse|is_horse/);
    expect(HOST).toMatch(
      /if \(a === 'bet' \|\| a === 'raise' \|\| a === 'all_in'\) this\.releasePricedCheckFolds\(\);/
    );
  });
});
