/**
 * LAW: THE BETTOR'S OWN RIVER FREQUENCY SETS THE PRIOR OF HIS SHOWN RECORD, AND ONLY TURNS A FOLD INTO A CALL
 * (lead-9 lane RFQ 2026-11-27, omahaRiverBetPriorReadsHisFrequency; l9-rfq/BUILD.md).
 * Value bets arrive at people's rate: his shrunk heads-up river first-bet frequency f implies a non-value share
 * 1 - (1 - q0) f0 / f, which replaces people's q0 as the prior mean of his shown-bet record. His shown bets still
 * dominate as they grow. The option reads a PLO4/PLO5 heads-up river BET in a single-raised or limped pot inside the
 * people-measured price; a decision changes only from a fold to a call; identity is no input.
 */
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { omahaPeoplePriorShare } from './HorseOmahaFacingBetPeoplePrior.js';
import {
  OMAHA_RIVER_FREQ_PEOPLE_RATE,
  OMAHA_RIVER_FREQ_PRIOR_OPPS,
  omahaRiverFrequencyPrior,
  omahaRiverFrequencySpotOf,
} from './HorseOmahaRiverFrequencyPrior.js';
import {
  decideRiverFreq,
  RIVER_FREQ_BASE,
  RIVER_FREQ_CALLED,
  RIVER_FREQ_ON,
  RIVER_FREQ_RECEIPT,
  riverFreqStates,
} from './HorseOmahaRiverFrequencyPrior.test-support.js';

const RIVER = {
  street: 'river' as const,
  potFrac: 0.75,
  isRaise: false,
  multiway: false,
  paid: 75,
  winnable: 175,
  rake: 0,
  twoStreet: false,
  record: null,
};
const kindOf = (d: { action?: unknown }): string => String(d.action);

describe('LAW: the river frequency prior', () => {
  enableBrainTelemetry();

  it('shrinks his frequency to people measured rate by the measured pseudo-opportunities and prices value at people rate', () => {
    const f0 = OMAHA_RIVER_FREQ_PEOPLE_RATE;
    const K = OMAHA_RIVER_FREQ_PRIOR_OPPS;
    const r = omahaRiverFrequencyPrior({ bets: 30, opps: 60 }, 0.45)!;
    expect(r.rate).toBeCloseTo((30 + K * f0) / (60 + K), 12);
    expect(r.nonValue).toBeCloseTo(1 - (0.55 * f0) / r.rate, 12);
    expect(r.nonValue).toBeGreaterThan(0.45);
  });

  it('is absent with no record, a frequency at or below people rate, a malformed record or no people share', () => {
    expect(omahaRiverFrequencyPrior(null, 0.45)).toBeNull();
    expect(omahaRiverFrequencyPrior({ bets: 3, opps: 20 }, 0.45)).toBeNull();
    expect(omahaRiverFrequencyPrior({ bets: 0, opps: 0 }, 0.45)).toBeNull();
    expect(omahaRiverFrequencyPrior({ bets: 9, opps: 5 }, 0.45)).toBeNull();
    expect(omahaRiverFrequencyPrior({ bets: 30, opps: 60 }, null)).toBeNull();
  });

  it('a frequent bettor with no shown record is priced with more non-value; a long value-heavy shown record outweighs it', () => {
    const base = omahaPeoplePriorShare(RIVER)!;
    const freq = omahaPeoplePriorShare({ ...RIVER, frequency: { bets: 30, opps: 60 } })!;
    expect(freq.share).toBeGreaterThan(base.share);
    const shown = { shown: 40, value: 34 };
    const longBase = omahaPeoplePriorShare({ ...RIVER, record: shown })!;
    const longFreq = omahaPeoplePriorShare({
      ...RIVER,
      record: shown,
      frequency: { bets: 30, opps: 60 },
    })!;
    expect(longFreq.share - longBase.share).toBeGreaterThan(0);
    expect(longFreq.share - longBase.share).toBeLessThan((freq.share - base.share) / 3);
  });

  it("without the frequency input, or on the turn or a raise, the price is today's exactly", () => {
    expect(omahaPeoplePriorShare({ ...RIVER, frequency: null })).toEqual(
      omahaPeoplePriorShare(RIVER)
    );
    const turn = { ...RIVER, street: 'turn' as const };
    expect(omahaPeoplePriorShare({ ...turn, frequency: { bets: 30, opps: 60 } })).toEqual(
      omahaPeoplePriorShare(turn)
    );
    const raise = { ...RIVER, isRaise: true };
    expect(omahaPeoplePriorShare({ ...raise, frequency: { bets: 30, opps: 60 } })).toEqual(
      omahaPeoplePriorShare(raise)
    );
  });

  it('reads PLO4 / PLO5 river bets in single-raised and limped pots only', () => {
    const single = [
      { stage: 'preflop', seat: 1, action: 'raise', amount: 3 },
      { stage: 'preflop', seat: 2, action: 'call', amount: 2 },
    ];
    const reraised = [
      ...single.slice(0, 1),
      { stage: 'preflop', seat: 2, action: 'raise', amount: 9 },
    ];
    expect(omahaRiverFrequencySpotOf('plo5', 'river', false, single as never)).toBe(true);
    expect(omahaRiverFrequencySpotOf('plo4', 'river', false, single as never)).toBe(true);
    expect(omahaRiverFrequencySpotOf('plo5', 'river', true, single as never)).toBe(false);
    expect(omahaRiverFrequencySpotOf('plo5', 'turn', false, single as never)).toBe(false);
    expect(omahaRiverFrequencySpotOf('plo6', 'river', false, single as never)).toBe(false);
    expect(omahaRiverFrequencySpotOf('nlh', 'river', false, single as never)).toBe(false);
    expect(omahaRiverFrequencySpotOf('plo5', 'river', false, reraised as never)).toBe(false);
  });

  const states = riverFreqStates();
  const FREQUENT = { bets: 70, opps: 100 };

  it('on real river decisions: off and on without a record decide the same; with a frequent record only folds become calls', () => {
    let read = 0;
    let called = 0;
    let changed = 0;
    for (const s of states) {
      const off = kindOf(decideRiverFreq(s, RIVER_FREQ_BASE, false, FREQUENT));
      expect(kindOf(decideRiverFreq(s, RIVER_FREQ_ON, false, null))).toBe(off);
      const r = withDecisionFireScope(() => decideRiverFreq(s, RIVER_FREQ_ON, true, FREQUENT));
      const on = kindOf(r.value);
      if (r.fired.has(RIVER_FREQ_RECEIPT)) read++;
      if (r.fired.has(RIVER_FREQ_CALLED)) called++;
      if (on !== off) {
        changed++;
        expect(off).toBe('fold');
        // a call of the whole stack is the engine's all_in; the option never raises (the verdict it adopts is a call)
        expect(['call', 'all_in']).toContain(on);
        if (on === 'all_in')
          expect(Number((r.value as { amount?: number }).amount ?? 0)).toBeLessThanOrEqual(
            s.player.stack + s.player.bet + 1e-9
          );
        expect(r.fired.has(RIVER_FREQ_CALLED)).toBe(true);
        expect(s.pot === 'single' || s.pot === 'limped').toBe(true);
      }
    }
    console.info(
      `[river frequency] ${states.length} river states: read ${read}, called ${called}, changed ${changed}`
    );
    expect(read).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(called);
  }, 300_000);

  it('without the people-measured prior the option changes nothing', () => {
    for (const s of states.slice(0, 40))
      expect(
        kindOf(decideRiverFreq(s, { omahaRiverBetPriorReadsHisFrequency: true }, false, FREQUENT))
      ).toBe(kindOf(decideRiverFreq(s, {}, false, FREQUENT)));
  }, 300_000);
});
