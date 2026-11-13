/**
 * Owner directive 2026-11-13 (00:23 Chicago): "An unknown opponent must receive
 * a neutral, explicitly uncertain read, not an automatic maniac/aggressive
 * classification." In Omaha every opponent without a disproof is read as an
 * aggressive raiser (presumedAggressorRead, owner update 2026-10-27); in
 * production that presumption fired 26.9 million times in three days against
 * 3.1 million disproofs, people and Horses alike.
 *
 * Option omahaNeutralUnknown (default OFF until its league comparison is
 * accepted): an Omaha opponent is read from their own measured hands only. No
 * read means no exploit layer engages, as against an opponent at the Horse
 * mean; a player whose own hands engage a read keeps it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  aggressiveBettorPressure,
  decayAndAdd,
  exploitHandIncrements,
  freshExploitCounters,
  maniacRaiseWidth,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';

const PERSON = '40000000-0000-4000-8000-00000000a11e';
const HORSE = '40000000-0000-4000-8000-00000000b0b0';

function raiser(id: string, hands: number): ExploitCounters {
  const c = freshExploitCounters();
  const inc = exploitHandIncrements([{ userId: id, action: 'raise', stage: 'preflop' }]).get(id)!;
  for (let n = 0; n < hands; n++) decayAndAdd(c, inc);
  return c;
}

function scope(neutral: boolean) {
  HorseMind.setDecisionScope('omaha:short', 'plo5', 'cash');
  HorseMind.setDecisionReadOptions(neutral ? { omahaNeutralUnknown: true } : {});
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaNeutralUnknown: an unknown Omaha opponent is read as neutral', () => {
  it('off (default): the existing presumption is unchanged', () => {
    scope(false);
    for (const id of [PERSON, HORSE]) {
      const read = HorseMind.opponentRead(id);
      expect(read?.presumed).toBe(true);
      expect(maniacRaiseWidth(read)).not.toBeNull();
    }
  });

  it('on: no presumed raise width and no bettor pressure, for people and Horses alike', () => {
    enableBrainTelemetry();
    drainFires();
    for (const variant of ['plo4', 'plo5', 'plo6']) {
      for (const sc of ['omaha:hu', 'omaha:short', 'omaha:full'] as const) {
        for (const mode of ['cash', 'tournament'] as const) {
          HorseMind.setDecisionScope(sc, variant, mode);
          HorseMind.setDecisionReadOptions({ omahaNeutralUnknown: true });
          for (const id of [PERSON, HORSE]) {
            const read = HorseMind.opponentRead(id);
            // Still a read (measured statistics, nothing engaged), so detectors
            // that fall back to measured evidence keep running.
            expect(read, `${variant} ${sc} ${mode}`).not.toBeNull();
            expect(read?.presumed, `${variant} ${sc} ${mode}`).toBeUndefined();
            expect(maniacRaiseWidth(read)).toBeNull();
            expect(aggressiveBettorPressure(read)).toBeNull();
          }
          HorseMind.setDecisionScope(null);
        }
      }
    }
    const fired = drainFires().find((f) => f.feature === 'plo_opponent_neutral_unknown');
    expect(fired?.fires ?? 0).toBe(3 * 3 * 2 * 2);
  });

  it('on: a player whose own hands show a wide raiser keeps that read', () => {
    HorseMind.setDecisionScope('omaha:short', 'plo5', 'cash');
    HorseMind.setDecisionReadOptions({ omahaNeutralUnknown: true });
    (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
      `omaha:short|${PERSON}`,
      raiser(PERSON, 120)
    );
    const read = HorseMind.opponentRead(PERSON);
    expect(read?.presumed).toBeUndefined();
    expect(maniacRaiseWidth(read)).not.toBeNull();
  });

  it('a player whose own hands disproved the presumption reads exactly as today, with no neutral receipt', () => {
    const quiet = freshExploitCounters();
    const inc = exploitHandIncrements([{ userId: PERSON, action: 'call', stage: 'preflop' }]).get(
      PERSON
    )!;
    for (let n = 0; n < 200; n++) decayAndAdd(quiet, inc);
    const seat = (neutral: boolean) => {
      HorseMind.reset();
      HorseMind.setDecisionScope('omaha:short', 'plo5', 'cash');
      HorseMind.setDecisionReadOptions(neutral ? { omahaNeutralUnknown: true } : {});
      (
        HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }
      ).exploitCounters.set(`omaha:short|${PERSON}`, quiet);
      return HorseMind.opponentRead(PERSON);
    };
    enableBrainTelemetry();
    drainFires();
    const off = seat(false);
    const on = seat(true);
    expect(on).toEqual(off);
    expect(drainFires().find((f) => f.feature === 'plo_opponent_neutral_unknown')).toBeUndefined();
  });

  it('the measured-evidence bully detector answers the same with the option on and off', () => {
    const lag = {
      hands: 60,
      vpip: 45,
      pfr: 24,
      threeBet: 8,
      aggr: 90,
      passive: 20,
      folds: 10,
      facedAggr: 40,
      postAggr: 40,
      postPassive: 8,
    };
    for (const neutral of [false, true]) {
      HorseMind.reset();
      HorseMind.setDecisionScope('omaha:short', 'plo5', 'cash');
      HorseMind.setDecisionReadOptions(neutral ? { omahaNeutralUnknown: true } : {});
      (HorseMind as unknown as { stats: Map<string, unknown> }).stats.set(PERSON, { ...lag });
      expect([neutral, HorseMind.isLagBully(PERSON)]).toEqual([neutral, true]);
    }
  });

  it("hold'em is untouched", () => {
    HorseMind.setDecisionScope('holdem:short', 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({ omahaNeutralUnknown: true });
    expect(HorseMind.opponentRead(PERSON)).toBeNull();
  });
});
