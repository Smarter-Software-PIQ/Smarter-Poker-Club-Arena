/**
 * LAW: THE RIVER RECORD COUNTS THE RIVER BETS HE HAD CALLED AND MUCKED (omahaRiverRecordCountsMuckedBets, default
 * OFF; PLO-OWNER lead-9 lane RV 2026-11-27).
 *
 * The bettor's own river record inside the people-measured price counted only the river bets he SHOWED. A bettor
 * whose called river bets end in a muck (public: the showdown lists him as mucked) was read from his shown winners
 * alone, as value-heavy, and the Horses folded more to him than to a stranger. With the option on, a river bet that
 * was called and mucked counts as a shown bet that was not value. Public events only; a bet he won uncontested and a
 * bet he folded to a raise are not counted; the people cell is unchanged; raises and re-raised pots are untouched.
 */
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  omahaBetReadIncrementsOf,
  omahaBetReadLearn,
  omahaBetReadOwnCellOf,
  omahaBetReadReset,
} from './HorseOmahaBetRead.js';
import { omahaPeoplePriorShare } from './HorseOmahaFacingBetPeoplePrior.js';
import { omahaRiverRecordCountsMuckedBets } from './HorseOmahaPeoplePriorHidden.js';
import {
  decideRiver,
  riverBetHand,
  riverStatesTheOptionReads,
} from './HorseOmahaRiverRecordMuckedBets.test-support.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';

const pre = (seat: number, action: string, amount: number) => ({
  stage: 'preflop',
  seat,
  action,
  amount,
});
const SINGLE = [pre(1, 'sb', 1), pre(2, 'bb', 2), pre(1, 'raise', 6), pre(2, 'call', 4)];
const RERAISED = [
  pre(1, 'sb', 1),
  pre(2, 'bb', 2),
  pre(1, 'raise', 6),
  pre(2, 'raise', 18),
  pre(1, 'call', 12),
];

describe('LAW: the river record counts the river bets he had called and mucked', () => {
  it('ships dark: release default off', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaRiverRecordCountsMuckedBets');
  });

  it('reads only a PLO4 / PLO5 river bet outside a re-raised pot', () => {
    expect(omahaRiverRecordCountsMuckedBets('plo5', 'river', false, SINGLE)).toBe(true);
    expect(omahaRiverRecordCountsMuckedBets('plo4', 'river', false, SINGLE)).toBe(true);
    expect(omahaRiverRecordCountsMuckedBets('plo5', 'river', true, SINGLE)).toBe(false);
    expect(omahaRiverRecordCountsMuckedBets('plo5', 'turn', false, SINGLE)).toBe(false);
    expect(omahaRiverRecordCountsMuckedBets('plo5', 'flop', false, SINGLE)).toBe(false);
    expect(omahaRiverRecordCountsMuckedBets('plo5', 'river', false, RERAISED)).toBe(false);
    expect(omahaRiverRecordCountsMuckedBets('plo6', 'river', false, SINGLE)).toBe(false);
    expect(omahaRiverRecordCountsMuckedBets('nlh', 'river', false, SINGLE)).toBe(false);
  });

  it('a called and mucked river bet is hidden; one won uncontested or folded to a raise is not', () => {
    const riverBet = (outcome: 'mucked' | 'uncontested' | 'folded_to_raise') =>
      omahaBetReadIncrementsOf(riverBetHand('x', 'plo5', 'p', 0.8, outcome) as never).find(
        (i) => i.userId === 'p' && i.street === 'river' && i.bet
      )?.bet;
    expect(riverBet('mucked')?.hidden).toBe(true);
    expect(riverBet('mucked')?.shown).toBe(false);
    expect(riverBet('uncontested')?.hidden).toBe(false);
    expect(riverBet('folded_to_raise')?.hidden).toBe(false);
  });

  it('his river record counts them only when the option asks, as bets that were not value', () => {
    omahaBetReadReset();
    for (let i = 0; i < 5; i++)
      omahaBetReadLearn(riverBetHand(`m${i}`, 'plo5', 'p', 1, 'mucked') as never);
    for (let i = 0; i < 3; i++)
      omahaBetReadLearn(riverBetHand(`u${i}`, 'plo5', 'p', 1, 'uncontested') as never);
    for (const laterBarrel of [false, true]) {
      const off = omahaBetReadOwnCellOf('p', 'plo5', 'river', 1, laterBarrel)!;
      const on = omahaBetReadOwnCellOf('p', 'plo5', 'river', 1, laterBarrel, true)!;
      expect(off.shown).toBe(0);
      expect(on.shown).toBeCloseTo(5, 6);
      expect(on.value).toBe(0);
    }
    omahaBetReadReset();
  });

  it('the price: mucked called bets raise his non-core share; the people cell is the same', () => {
    const input = {
      street: 'river' as const,
      potFrac: 0.8,
      isRaise: false,
      multiway: false,
      paid: 8,
      winnable: 18,
      rake: 0,
      twoStreet: false,
    };
    const none = omahaPeoplePriorShare({ ...input, record: null })!;
    const shownOnly = omahaPeoplePriorShare({ ...input, record: { shown: 2, value: 2 } })!;
    const withMucked = omahaPeoplePriorShare({ ...input, record: { shown: 25, value: 2 } })!;
    const nonCore = (r: typeof none) => r.regions!.middle + r.regions!.bottom;
    // today: two shown winners read him as stronger than a stranger
    expect(nonCore(shownOnly)).toBeLessThan(nonCore(none));
    // counted: 23 mucked called bets read him as weaker than a stranger
    expect(nonCore(withMucked)).toBeGreaterThan(nonCore(none));
    expect(withMucked.share).toBeGreaterThan(none.share);
    for (const r of [shownOnly, withMucked]) {
      expect(r.people).toBe(none.people);
      expect(r.peopleN).toBe(none.peopleN);
      expect(r.prior).toBe(none.prior);
    }
  });

  describe('the engine, on committed real heads-up river facing-bet states', () => {
    enableBrainTelemetry();
    const states = riverStatesTheOptionReads(12);

    it('there are states the option reads', () => {
      expect(states.length).toBeGreaterThanOrEqual(6);
    });

    it('with no mucked bet in his record the option changes nothing and names nothing', () => {
      for (const s of states) {
        const off = withDecisionFireScope(() => decideRiver(s, false, true, 0));
        const on = withDecisionFireScope(() => decideRiver(s, true, true, 0));
        expect(on.value.action).toBe(off.value.action);
        expect(on.value.amount).toBe(off.value.amount);
        expect(on.fired.has('omaha_river_mucked_bets_record_read')).toBe(false);
      }
    });

    it('off never reads them; on only ever moves a fold to a call, and never raises', () => {
      let moved = 0;
      for (const s of states) {
        const off = withDecisionFireScope(() => decideRiver(s, false, true, 6));
        const on = withDecisionFireScope(() => decideRiver(s, true, true, 6));
        expect(off.fired.has('omaha_river_mucked_bets_record_read')).toBe(false);
        expect(on.fired.has('omaha_river_mucked_bets_record_read')).toBe(true);
        if (on.value.action !== off.value.action) {
          moved++;
          expect(off.value.action).toBe('fold');
          expect(on.value.action).toBe('call');
        }
      }
      console.info(`[river mucked bets] ${states.length} states, ${moved} folds became calls`);
    });
  });
});
