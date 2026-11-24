/**
 * The 20 verdict-made folds of plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 3c, re-priced (PLO-OWNER lead-6
 * 2026-11-24). Labels are that report's independent check (the measured Horse bettor range for a first wager of the
 * size, standard realization 0.75 / 0.85 on the flop, 0.85 / 0.92 on the turn). Priced here against the measured
 * population itself (no F6 bound: the bettor priced as a known one), with omahaFacingBetRangeIsMeasuredByLine,
 * omahaFacingBetIndifferenceCalls and omahaFlopRealizationIsPriced on.
 *
 * Where the measured tables and the label disagree the measured price is asserted and the reason is written down:
 * - three WRONG labels are RAISES (130426, 110595 on the flop, 121333 on the turn) that the check priced against a
 *   first-wager range; the measured raise ranges are 84-86% value (shown raises, Nov 17-24), and the Horse's
 *   showdown share against them is below the price (0.235 < 0.299, 0.212 < 0.278, 0.092 < 0.156);
 * - 220817 (PLO5 river, top two pair on a three-diamond board, 0.64 pot after a turn barrel): about 45% of PLO5
 *   holdings beat the hand and the measured barrel range wins 87% against it (pWin 0.13 < price 0.28);
 * - four RIGHT labels were close at the check's fixed realization and the tree or the exact count calls:
 *   121058 and 110927 (flop, showdown share 0.33 / 0.39 against price 0.23 / 0.25; the two-street tree prices the
 *   later streets instead of a fixed 0.75), 210970 (turn, EV +0.03 pot), 122164 (river, pWin 0.214 against 0.206).
 * With no record and F6 on (an unknown bettor), 220817 also calls; the raises still fold (F6 never bounds a raise).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pricedOutcome } from './HorseOmahaFacingBetPriced.test-support.js';

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'HorseOmahaFacingBetPriced.realHands.fixture.json'), 'utf8')
) as { spots: Array<{ k: string; label: 'wrong_fold' | 'right_fold'; gs: never; player: never }> };

const KNOWN_BETTOR: Readonly<Record<string, 'call' | 'fold'>> = {
  'plo4_cash_hu:121837:5': 'call',
  'plo5_cash_6max:210569:9': 'call',
  'plo5_cash_6max:210398:11': 'call',
  'plo5_cash_hu:221274:9': 'call',
  'plo5_cash_345:230418:11': 'call',
  'plo4_cash_hu:121206:9': 'call',
  'plo4_cash_345:130426:7': 'fold',
  'plo4_cash_6max:110595:10': 'fold',
  'plo4_cash_hu:121333:7': 'fold',
  'plo5_cash_hu:220817:8': 'fold',
  'plo5_cash_6max:210064:9': 'fold',
  'plo5_cash_345:230228:5': 'fold',
  'plo4_cash_hu:121132:6': 'fold',
  'plo4_cash_345:130079:9': 'fold',
  'plo5_cash_6max:210698:10': 'fold',
  'plo4_cash_hu:120368:9': 'fold',
  'plo4_cash_hu:121058:5': 'call',
  'plo4_cash_6max:110927:9': 'call',
  'plo5_cash_6max:210970:10': 'call',
  'plo4_cash_hu:122164:9': 'call',
};
const LABEL_DISAGREES = new Set([
  'plo4_cash_345:130426:7',
  'plo4_cash_6max:110595:10',
  'plo4_cash_hu:121333:7',
  'plo5_cash_hu:220817:8',
  'plo4_cash_hu:121058:5',
  'plo4_cash_6max:110927:9',
  'plo5_cash_6max:210970:10',
  'plo4_cash_hu:122164:9',
]);

describe('the 20 re-priced folds of the over-fold report', () => {
  it("today's verdicts fold every one of them", () => {
    for (const s of FIXTURE.spots) {
      const o = pricedOutcome(
        { k: s.k, legacy: 'fold', gs: s.gs, player: s.player },
        'today',
        true
      );
      expect(o?.call, s.k).toBe(false);
    }
  }, 120_000);

  it('priced on the measured ranges: the label holds wherever the measured price agrees, and the rest are written down', () => {
    expect(Object.keys(KNOWN_BETTOR).sort()).toEqual(FIXTURE.spots.map((s) => s.k).sort());
    let wrongCalled = 0;
    for (const s of FIXTURE.spots) {
      const o = pricedOutcome(
        { k: s.k, legacy: 'fold', gs: s.gs, player: s.player },
        'onKnownBettor',
        true
      );
      const got = o?.call ? 'call' : 'fold';
      expect(got, s.k).toBe(KNOWN_BETTOR[s.k]);
      const labelSays = s.label === 'wrong_fold' ? 'call' : 'fold';
      expect(got === labelSays, `${s.k} label ${s.label}`).toBe(!LABEL_DISAGREES.has(s.k));
      if (s.label === 'wrong_fold' && got === 'call') wrongCalled++;
    }
    expect(wrongCalled).toBe(6);
  }, 120_000);

  it('against an unknown bettor (F6 on) every first-wager WRONG fold calls; the raises still fold', () => {
    for (const s of FIXTURE.spots.filter((x) => x.label === 'wrong_fold')) {
      const o = pricedOutcome({ k: s.k, legacy: 'fold', gs: s.gs, player: s.player }, 'on', true);
      const raise = [
        'plo4_cash_345:130426:7',
        'plo4_cash_6max:110595:10',
        'plo4_cash_hu:121333:7',
      ].includes(s.k);
      expect(o?.call ? 'call' : 'fold', s.k).toBe(raise ? 'fold' : 'call');
    }
  }, 120_000);
});
