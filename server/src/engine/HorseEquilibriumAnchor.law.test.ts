/**
 * LAW: THE OPPONENT READS OF THE ANCHORED READERS ARE ANCHORED TO EQUILIBRIUM, AND A THIN RECORD CANNOT DOMINATE
 * (2026-11-26, lane prior-anchor; the Horse rules' prior-anchor law).
 * - the indifference rows are the closed forms (fold s / (1 + s), joint 1 - (1 / (1 + s))^(1/m), value 1 - s / (1 + 2s));
 * - in anchor mode hudStat never reads the population row or a caller's measured cell, and k >= 20: a 5-opportunity
 *   record carries at most 20% of the read and a 300-opportunity record at least 93.75%;
 * - out of anchor mode hudStat is what it was (the population row);
 * - the mode is set only with the store option and one of the anchored readers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HUD_ANCHOR_K_FLOOR,
  HUD_EQUILIBRIUM_ANCHOR,
  anchorFold,
  anchorValueShare,
  hudAnchorMode,
  hudAnchorOptionsOn,
  withHudEquilibriumAnchor,
} from './HorseEquilibriumAnchor.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import {
  buildHudPacket,
  clearDecisionHud,
  hudStat,
  installDecisionHud,
} from './opponentHud/OpponentHud.js';

const OPP = '50000000-0000-4000-8000-0000000000a1';
const AT = 1_800_000_000_000;
afterEach(() => clearDecisionHud());

function packetWith(n: number, hits: number) {
  const p = emptyHudProfile(OPP, 'plo5');
  p.hands = n;
  p.life['f.fb.bg.hu'] = [n, hits];
  p.rec['f.fb.bg.hu'] = [n, hits];
  p.recAt = AT;
  // a population row far from equilibrium (a Horse field that never folds)
  return buildHudPacket('plo5', [p], { 'f.fb.bg.hu': [0.05, 400] }, AT, 'flop');
}

describe('the anchored readers read equilibrium, and a thin record cannot dominate', () => {
  it('the indifference rows are the closed forms', () => {
    expect(anchorFold(1)).toBeCloseTo(0.5, 9);
    expect(anchorFold(0.5)).toBeCloseTo(1 / 3, 9);
    expect(anchorFold(1, 2)).toBeCloseTo(1 - Math.SQRT1_2, 9);
    expect(anchorValueShare(1)).toBeCloseTo(2 / 3, 9);
    expect(HUD_EQUILIBRIUM_ANCHOR['f.fb.bg.hu']).toBeCloseTo(0.5, 4);
    expect(HUD_EQUILIBRIUM_ANCHOR['r.fBet.l']).toBeCloseTo(0.9 / 1.9, 4);
    expect(HUD_EQUILIBRIUM_ANCHOR['pf.f3bet']).toBe(0.5);
  });

  it('in anchor mode the read shrinks toward the anchor with k >= 20, never toward the population row', () => {
    installDecisionHud(packetWith(0, 0));
    expect(
      withHudEquilibriumAnchor(true, () => hudStat(OPP, 'plo5', 'f.fb.bg.hu', 0.01).p)
    ).toBeCloseTo(0.5, 9);
    // thin: 5 opportunities, all folds -> weight <= 20%
    installDecisionHud(packetWith(5, 5));
    const thin = withHudEquilibriumAnchor(true, () => hudStat(OPP, 'plo5', 'f.fb.bg.hu'));
    expect(thin.weight).toBeLessThanOrEqual(5 / (5 + HUD_ANCHOR_K_FLOOR) + 1e-9);
    expect(thin.p!).toBeLessThanOrEqual(0.5 + 0.5 * 0.2 + 1e-9);
    // long: 300 opportunities on a statistic with no fitted k (k = the floor 20) -> weight >= 93.75%; a statistic
    // whose population k is larger keeps that larger k (k = max(20, fitted): the anchor never trusts a record faster)
    const p = emptyHudProfile(OPP, 'plo5');
    p.hands = 300;
    p.life['t.fb.sm.hu'] = [300, 300];
    p.rec['t.fb.sm.hu'] = [300, 300];
    p.recAt = AT;
    installDecisionHud(buildHudPacket('plo5', [p], {}, AT, 'turn'));
    const long = withHudEquilibriumAnchor(true, () => hudStat(OPP, 'plo5', 't.fb.sm.hu'));
    expect(long.weight).toBeGreaterThanOrEqual(300 / 320 - 1e-9);
  });

  it('out of anchor mode the read is the population row, as before', () => {
    installDecisionHud(packetWith(0, 0));
    expect(hudAnchorMode()).toBe(false);
    expect(hudStat(OPP, 'plo5', 'f.fb.bg.hu').p).toBeCloseTo(0.05, 9);
  });

  it('the mode needs the store option and an anchored reader', () => {
    expect(hudAnchorOptionsOn({})).toBe(false);
    expect(hudAnchorOptionsOn({ omahaOpponentLifetimeHud: true })).toBe(false);
    expect(hudAnchorOptionsOn({ omahaOpponentLifetimeHudDecides: true })).toBe(false);
    expect(
      hudAnchorOptionsOn({ omahaOpponentLifetimeHud: true, omahaOpponentLifetimeHudDecides: true })
    ).toBe(true);
    expect(
      hudAnchorOptionsOn({
        omahaOpponentLifetimeHud: true,
        omahaPreflopReadIsPricedFromLifetime: true,
      })
    ).toBe(true);
  });
});
