import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sliceMethod } from '../testHelpers/sourceWindow.js';
import { acceleratedLevelMs } from './acceleratedLevels.js';
import { playableSpinBlinds, spinRuleManifest } from './SpinDrawReceipt.js';
import { withLockedLevelClock } from './lockedLevelClock.js';

const source = readFileSync('src/tournament/TournamentManagerBase.ts', 'utf8');
const runtime = ts.transpileModule(
  `return { ${['protected rawLevelDurationMs(', 'protected levelDurationMs(']
    .map((signature) => sliceMethod(source, signature).replace(/^protected\s+/, ''))
    .join(',')} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;
const methods = new Function('acceleratedLevelMs', runtime)(acceleratedLevelMs);

describe('owner November 1: buy-ins above 25 use seven to ten minute levels', () => {
  for (const buyIn of [25, 25.01, 50, 200]) {
    for (const accelerated of [false, true]) {
      for (const minutes of [3, 5, 7, 8, 9, 10, 15]) {
        it(`actual timer: buy-in ${buyIn}, ${minutes} minutes, accelerated ${accelerated}`, () => {
          const manager = {
            ...methods,
            tournamentCache: { buy_in_amount: buyIn, accelerated_mtt: accelerated },
            isLateRegClosed: () => true,
          };
          const prior = accelerated
            ? acceleratedLevelMs(Math.max(5, minutes) * 60000)
            : Math.max(5, minutes) * 60000;
          const expected = buyIn > 25 ? Math.min(600000, Math.max(420000, prior)) : prior;
          for (const key of ['durationMinutes', 'duration_minutes', 'duration']) {
            expect(
              manager.levelDurationMs({ [key]: key === 'duration' ? minutes * 60 : minutes })
            ).toBe(expected);
          }
          expect(manager.levelDurationMs({ isBreak: true, durationMinutes: minutes })).toBe(prior);
        });
      }
    }
  }

  it.each(['MTT', 'SATELLITE', 'SPIN', 'SNG'])(
    'creator clamps only invalid playable %s clocks and leaves price 25 unchanged',
    (format) => {
      const structure = [
        { duration: 180 },
        { duration_minutes: 8 },
        { durationMinutes: 10 },
        { durationMinutes: 14 },
        { isBreak: true, durationMinutes: 4 },
      ];
      const row = { tournament_type: format, buy_in_amount: 50, blind_structure: structure };
      const created = withLockedLevelClock(row);
      expect(created.blind_structure).toEqual([
        { durationMinutes: 7 },
        { duration_minutes: 8 },
        { durationMinutes: 10 },
        { durationMinutes: 10 },
        structure[4],
      ]);
      expect(structure[0]).toEqual({ duration: 180 });
      expect(withLockedLevelClock(created)).toEqual(created);
    }
  );

  it('an entry fee never moves an exactly-25 buy-in across the boundary', () => {
    const row = {
      tournament_type: 'SNG',
      buy_in_amount: 25,
      buy_in_fee: 5,
      blind_structure: [{ duration: 180 }],
    };
    expect(withLockedLevelClock(row)).toBe(row);
  });

  it('Spin playback projects the new clock without changing an immutable booked ladder', () => {
    const raw = [{ level: 1, smallBlind: 5, bigBlind: 10, ante: 0, duration: 180 }];
    expect(playableSpinBlinds(raw, 50)[0]).toMatchObject({ duration: 420, durationMinutes: 7 });
    expect(playableSpinBlinds(raw, 25)[0]).toMatchObject({ duration: 300, durationMinutes: 5 });
    expect(raw[0].duration).toBe(180);
    for (const tier of spinRuleManifest(50, 500).tiers) {
      expect(tier.levelMinutes).toBeGreaterThanOrEqual(7);
      expect(tier.levelMinutes).toBeLessThanOrEqual(10);
      expect(tier.blind_structure.every((level) => level.duration === tier.levelMinutes * 60)).toBe(
        true
      );
      expect(
        tier.blind_structure.every((level) => level.duration >= 420 && level.duration <= 600)
      ).toBe(true);
    }
  });

  it('derived late registration follows the corrected structure', () => {
    const row = {
      tournament_type: 'MTT',
      buy_in_amount: 50,
      blind_structure: [{ durationMinutes: 5 }, { durationMinutes: 5 }],
      late_reg_levels: 2,
      late_reg_mins: 10,
    };
    expect(withLockedLevelClock(row).late_reg_mins).toBe(14);
    expect(withLockedLevelClock({ ...row, late_reg_mins: 17 }).late_reg_mins).toBe(17);
  });
});
