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
  forgetLightningCheckFoldArm,
  LIGHTNING_CHECK_FOLD_ARM_TTL_MS,
  lightningCheckFoldCarries,
  lightningCheckFoldReleaseDue,
  lightningCheckFoldRestoreDue,
  lightningCheckFoldSurvives,
  lightningEngineFoldedArm,
  rememberLightningCheckFoldArm,
  rememberedLightningCheckFoldArm,
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
    // Bounded by the next statement of the handler, never by a byte count.
    const block = PAGE.slice(start, PAGE.indexOf('// DEAD-WIRING FIX 2026-08-15', start));
    expect(start).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(0);
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
      /const armedHandKey = lightningCheckFoldArmRef\.current;\s*lightningCheckFoldArmRef\.current = null;/
    );
    expect(block).toMatch(
      /lightningEngineFoldedArm\(\{\s*armedHandKey,\s*lastLiveHandKey: lightningLiveHandKeyRef\.current,\s*armedChoice: preActionArmedRef\.current,\s*heroStatus: hero\.status,/
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

describe('the arm is one hand’s, on this felt and in this browser', () => {
  const folded = {
    armedHandKey: HAND,
    lastLiveHandKey: HAND,
    armedChoice: 'fold',
    heroStatus: 'active',
  };
  it('an idle snapshot shows a fold only for the arm of the hand that was just live', () => {
    expect(lightningEngineFoldedArm(folded)).toBe(true);
    // A leftover from an earlier hand, or a hand voided with nothing armed.
    expect(lightningEngineFoldedArm({ ...folded, armedHandKey: NEXT })).toBe(false);
    expect(lightningEngineFoldedArm({ ...folded, armedHandKey: null })).toBe(false);
    expect(lightningEngineFoldedArm({ ...folded, lastLiveHandKey: null })).toBe(false);
    // Another choice is on the bar, or the hero is already folded or absent.
    for (const armedChoice of [null, 'check', 'call', 'callAny'])
      expect(lightningEngineFoldedArm({ ...folded, armedChoice })).toBe(false);
    expect(lightningEngineFoldedArm({ ...folded, heroStatus: 'folded' })).toBe(false);
    expect(lightningEngineFoldedArm({ ...folded, heroStatus: null })).toBe(false);
  });
  it('every path that clears the bar clears the arm, and the live hand key is tracked', () => {
    expect(PAGE).toMatch(
      /preActionArmedRef\.current = preAction;[^;]*?if \(preAction === null\) lightningCheckFoldArmRef\.current = null;/
    );
    expect(PAGE).toMatch(
      /if \(!idle\)\s*lightningLiveHandKeyRef\.current = lightningRoomRef\.current\s*\? lightningHandKey\(engineSnapshot as LightningSnapshotFields\)\s*: null;/
    );
  });

  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };
  it('remembers one hand per pool session, and forgets it', () => {
    const store = memory();
    rememberLightningCheckFoldArm('pool-a', HAND, 1_000, store);
    rememberLightningCheckFoldArm('pool-b', NEXT, 1_000, store);
    expect(rememberedLightningCheckFoldArm('pool-a', 2_000, store)).toBe(HAND);
    expect(rememberedLightningCheckFoldArm('pool-b', 2_000, store)).toBe(NEXT);
    expect(rememberedLightningCheckFoldArm('pool-c', 2_000, store)).toBeNull();
    forgetLightningCheckFoldArm('pool-a', store);
    expect(rememberedLightningCheckFoldArm('pool-a', 2_000, store)).toBeNull();
    expect(rememberedLightningCheckFoldArm('pool-b', 2_000, store)).toBe(NEXT);
  });
  it('a record expires, and a damaged, future-dated or unreadable one is no record', () => {
    const store = memory();
    rememberLightningCheckFoldArm('pool', HAND, 1_000, store);
    expect(
      rememberedLightningCheckFoldArm('pool', 1_000 + LIGHTNING_CHECK_FOLD_ARM_TTL_MS, store)
    ).toBe(HAND);
    expect(
      rememberedLightningCheckFoldArm('pool', 1_001 + LIGHTNING_CHECK_FOLD_ARM_TTL_MS, store)
    ).toBeNull();
    expect(rememberedLightningCheckFoldArm('pool', -120_000, store)).toBeNull();
    const [key] = [...store.data.keys()];
    for (const bad of [
      '',
      'not json',
      'null',
      '{}',
      '{"k":"","t":1}',
      '{"k":7,"t":1}',
      '{"k":"x"}',
    ]) {
      store.data.set(key, bad);
      expect(rememberedLightningCheckFoldArm('pool', 2_000, store)).toBeNull();
    }
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberLightningCheckFoldArm('pool', HAND, 1, broken)).not.toThrow();
    expect(() => forgetLightningCheckFoldArm('pool', broken)).not.toThrow();
    expect(rememberedLightningCheckFoldArm('pool', 1, broken)).toBeNull();
    expect(rememberedLightningCheckFoldArm('pool', 1, null)).toBeNull();
  });

  const restore = {
    lightningRoom: true,
    rememberedHandKey: HAND,
    currentHandKey: HAND,
    preAction: null,
    engineCarries: true,
    handLive: true,
    heroStatus: 'active',
    callDue: 0,
    heroTurn: false,
  };
  it('a reload of the armed hand lights the toggle again', () => {
    expect(lightningCheckFoldRestoreDue(restore)).toBe(true);
  });
  it('never in another hand, a dead hand, a Classic table or against an engine that spends the arm', () => {
    expect(lightningCheckFoldRestoreDue({ ...restore, currentHandKey: NEXT })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, currentHandKey: null })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, rememberedHandKey: null })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, handLive: false })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, lightningRoom: false })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, engineCarries: false })).toBe(false);
  });
  it('never over another choice, on the hero’s turn, once chips are owed, or out of the hand', () => {
    expect(lightningCheckFoldRestoreDue({ ...restore, preAction: 'callAny' })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, heroTurn: true })).toBe(false);
    expect(lightningCheckFoldRestoreDue({ ...restore, callDue: 4 })).toBe(false);
    for (const heroStatus of ['folded', 'all_in', null, undefined])
      expect(lightningCheckFoldRestoreDue({ ...restore, heroStatus })).toBe(false);
  });
  it('the restore sends nothing, decides once per mount, and the record follows the bar', () => {
    const start = PAGE.indexOf('const lightningRememberedArmRef = useRef');
    const block = PAGE.slice(
      start,
      PAGE.indexOf('/* LIGHTNING PHASE 12 (spec ACTION LATENCY', start)
    );
    expect(start).toBeGreaterThan(0);
    // Consumed before it is judged: one decision per mount.
    expect(block).toMatch(/const key = remembered\.key;\s*remembered\.key = null;/);
    // The engine already holds it: the one-shot marker stops the arm being sent again.
    expect(block).toMatch(
      /preActionHeldByEngineRef\.current = 'fold';[\s\S]*?lightningCheckFoldArmRef\.current = key;\s*setPreAction\('fold'\);/
    );
    expect(block).toMatch(
      /if \(armed !== null && lightningEngineCarries\) rememberLightningCheckFoldArm\(tableId, armed\);\s*else if \(lightningRememberedArmRef\.current\.key === null\) forgetLightningCheckFoldArm\(tableId\);/
    );
    // Read only in a Lightning room.
    expect(block).toMatch(
      /key: tableId && lightningRoom \? rememberedLightningCheckFoldArm\(tableId\) : null,/
    );
  });
});
