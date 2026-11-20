/**
 * LAW: AN OPPONENT IS READ FROM HIS LIFETIME, FROM HAND ONE (2026-11-20, PLO-OWNER lane OPPONENT-HUD; owner 3:15 PM
 * Chicago Nov 20; lead ruling 3:19 PM). With HorseDecideOpts.omahaOpponentLifetimeHud (read as === true, DEFAULT
 * OFF; HorseMind read option opponentLifetimeHud), a PLO4/PLO5 cash opponent read takes his counters from his
 * lifetime public profile carried by the decision: a player whose lifetime shows a tight raiser is read tight at his
 * first decision of a session, with no hand observed in this process. Off, or without a profile of him, or in PLO6,
 * the read is exactly what it was. One formula for every opponent: two ids with the same history read the same.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { emptyHudProfile, type OpponentHudProfile } from './opponentHud/OpponentHudProfile.js';
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';

const TIGHT = '50000000-0000-4000-8000-0000000000a1';
const TWIN = '50000000-0000-4000-8000-0000000000a2';
const T = 1_800_000_000_000;

function tightLifetime(user: string, family: 'plo4' | 'plo5'): OpponentHudProfile {
  const p = emptyHudProfile(user, family);
  p.hands = 400;
  p.wm = T;
  p.recAt = T;
  const set = (k: string, o: number, h: number) => {
    p.life[k] = [o, h];
    p.rec[k] = [o, h];
  };
  set('pf.vpip', 400, 60);
  set('pf.pfr', 400, 16);
  set('pf.open', 200, 10);
  set('pf.3bet', 150, 3);
  set('pf.f3bet', 20, 15);
  set('f.betCk', 100, 20);
  set('f.fBet', 80, 50);
  set('r.cBet', 30, 6);
  return p;
}

function readFor(variant: string, on: boolean, user = TIGHT) {
  HorseMind.setDecisionScope('omaha:full', variant, 'cash');
  HorseMind.setDecisionReadOptions(on ? { opponentLifetimeHud: true } : {});
  const r = HorseMind.opponentRead(user);
  HorseMind.setDecisionScope(null);
  return r;
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

describe('a PLO4/PLO5 opponent is read from his lifetime public profile from hand one (option on)', () => {
  it('off: the packet changes nothing (an unknown opponent is presumed, exactly as main)', () => {
    const before = readFor('plo5', false);
    installDecisionHud(buildHudPacket('plo5', [tightLifetime(TIGHT, 'plo5')], {}, T, 'preflop'));
    const after = readFor('plo5', false);
    expect(after).toEqual(before);
    expect(before?.presumed).toBe(true);
  });

  it('on: his lifetime tight raising disproves the presumption at his first decision, receipted', () => {
    enableBrainTelemetry();
    drainFires();
    installDecisionHud(buildHudPacket('plo5', [tightLifetime(TIGHT, 'plo5')], {}, T, 'preflop'));
    const read = readFor('plo5', true);
    expect(read?.presumed === true).toBe(false);
    const fires = drainFires();
    expect(fires.some((f) => f.feature === 'opponent_hud_exploit_counters')).toBe(true);
  });

  it('on: the same history reads the same for any two opponents (no kind, no name)', () => {
    installDecisionHud(
      buildHudPacket(
        'plo5',
        [tightLifetime(TIGHT, 'plo5'), tightLifetime(TWIN, 'plo5')],
        {},
        T,
        'flop'
      )
    );
    expect(readFor('plo5', true, TIGHT)).toEqual(readFor('plo5', true, TWIN));
  });

  it('on: no profile of him, another family in the packet, or PLO6: the read is what it was', () => {
    const base5 = readFor('plo5', false);
    installDecisionHud(buildHudPacket('plo4', [tightLifetime(TIGHT, 'plo4')], {}, T, 'preflop'));
    expect(readFor('plo5', true)).toEqual(base5);
    clearDecisionHud();
    const base6 = readFor('plo6', false);
    installDecisionHud(buildHudPacket('plo5', [tightLifetime(TIGHT, 'plo5')], {}, T, 'preflop'));
    expect(readFor('plo6', true)).toEqual(base6);
    expect(readFor('plo5', true, TWIN)).toEqual(readFor('plo5', false, TWIN));
  });

  it('the decide option reaches the read options as === true, PLO4/PLO5 cash only', () => {
    const src = readFileSync(resolve(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(src).toContain('...(opts.omahaOpponentLifetimeHud === true &&');
    expect(src).toContain('? { opponentLifetimeHud: true }');
  });

  it('the snapshot carries the packet only while armed, and the sampling key never reads it', () => {
    const proto = readFileSync(resolve(__dirname, 'horseDecision/protocol.ts'), 'utf8');
    expect(proto).toContain(
      '...(input.opponentHud !== undefined ? { opponentHud: input.opponentHud } : {}),'
    );
    expect(proto).toContain('input.opponentHud === undefined');
  });
});
