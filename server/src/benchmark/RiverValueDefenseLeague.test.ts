/**
 * The two-skill river measurement (RiverValueDefenseLeague.ts) measures what
 * it says: each contrast changes exactly one candidate flag, the aggressor
 * pool plays the tendency it is named for, and a cell replays exactly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { humanCalibratedProfileFor } from './HumanCalibratedPopulation.js';
import { RBLM_HERO_SEAT } from './RiverBluffBaselineLeague.js';
import {
  RVDL_AGGRESSOR_CUTOFFS,
  RVDL_SKILLS,
  rvdlAggressorProfile,
  rvdlArms,
  rvdlSeatKind,
  runRiverValueDefenseCell,
} from './RiverValueDefenseLeague.js';

describe('river value and defense league', { timeout: 600_000 }, () => {
  beforeAll(() => enableBrainTelemetry());

  it('each contrast turns exactly one candidate on against production', () => {
    for (const skill of RVDL_SKILLS) {
      const { a, b } = rvdlArms(skill);
      expect(a).toEqual({ [skill]: true });
      expect(b).toEqual({});
    }
  });

  it('aggressors open wide and bet most spots they are checked to', () => {
    for (const v of ['nlh', 'plo5']) {
      const base = humanCalibratedProfileFor(v);
      const ag = rvdlAggressorProfile(v);
      expect(ag.cutoffs!['preflop/unopened']!.fold!).toBeLessThan(
        base.cutoffs!['preflop/unopened']!.fold!
      );
      for (const street of ['flop', 'turn', 'river'] as const) {
        expect(ag.cutoffs![`${street}/checked_to`]!.bet).toBe(RVDL_AGGRESSOR_CUTOFFS.checkedToBet);
        expect(ag.cutoffs![`${street}/checked_to`]!.bet!).toBeLessThan(
          base.cutoffs![`${street}/checked_to`]!.bet!
        );
        expect(ag.cutoffs![`${street}/facing_bet`]!.raise).toBe(
          base.cutoffs![`${street}/facing_bet`]!.raise
        );
      }
    }
  });

  it('every pool seats the hero once and the field it names', () => {
    expect(rvdlSeatKind('aggressors', RBLM_HERO_SEAT)).toBe('hero');
    expect([1, 2, 3, 4, 5].every((s) => rvdlSeatKind('aggressors', s) === 'aggressors')).toBe(true);
    expect([1, 2, 3, 4, 5].map((s) => rvdlSeatKind('mixed', s))).toEqual([
      'horse',
      'calibrated',
      'stations',
      'folders',
      'horse',
    ]);
  });

  it('a cell replays exactly and plays only legal actions', async () => {
    const run = () =>
      runRiverValueDefenseCell('riverPositionDefense', 'nlh', 'cash', 'aggressors', 40, 7, 2);
    const [x, y] = [await run(), await run()];
    expect(x.armA.netBB).toBe(y.armA.netBB);
    expect(x.armB.netBB).toBe(y.armB.netBB);
    expect(x.armA.hands).toBe(40);
    expect(x.illegalActions + x.truncatedStreets + x.brainExceptionFallbacks).toBe(0);
  });
});
